/**
 * ScrollEngine — Voice-tracked scrolling for the teleprompter.
 * Ported from DemoPrompter app_native.py lines 538-693.
 *
 * Algorithm:
 * 1. Split text into sentences on .!?\n
 * 2. Run Web Speech API continuous recognition
 * 3. Take last 20 words of running transcript
 * 4. Fuzzy-match against first 12 words of each sentence (forward-only)
 * 5. Similarity threshold: 0.35 (calibrated for bigram Dice coefficient)
 * 6. On match: scroll to that sentence, advance pointer
 * 7. Forward-only: never scroll backwards (except 1 sentence for re-check)
 */

// Tuning parameters for voice tracking matching
const TAIL_WORD_COUNT = 20;
const SENTENCE_PREFIX_WORDS = 12;
const DISTINCTIVE_WORD_BONUS = 0.15;
const MATCH_THRESHOLD = 0.35;
const DISTINCTIVE_WORD_MIN_LENGTH = 4;
const SPEAKING_WPM = 150;

class ScrollEngine {
  constructor() {
    this._sentences = [];
    this._currentIdx = 0;
    this._recognition = null;
    this._transcript = '';
    this._isListening = false;
    this._onMatch = null;       // callback(sentenceIndex)
    this._onStatusChange = null; // callback(status: 'listening'|'stopped'|'error')
    this._restartTimer = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Split text into sentences with position metadata.
   * @param {string} text
   * @returns {Array<{text: string, startOffset: number, endOffset: number}>}
   */
  prepareSentences(text) {
    if (!text || !text.trim()) {
      this._sentences = [];
      return this._sentences;
    }

    // Split on sentence-ending punctuation followed by whitespace, or newlines
    const parts = text.trim().split(/(?<=[.!?])\s+|\n+/);
    let offset = 0;
    this._sentences = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '---') continue;

      const safeStart = Math.max(0, text.indexOf(trimmed, offset));
      const safeEnd = safeStart + trimmed.length;
      this._sentences.push({
        text: trimmed,
        startOffset: safeStart,
        endOffset: safeEnd
      });

      offset = safeEnd;
    }

    this._currentIdx = 0;
    this._transcript = '';
    return this._sentences;
  }

  /**
   * Start Web Speech API continuous recognition.
   * @param {function} onMatch - callback(sentenceIndex) when a new sentence is matched
   * @param {function} onStatusChange - callback(status) for UI updates
   * @returns {boolean} true if started successfully
   */
  startVoiceTracking(onMatch, onStatusChange) {
    this._onMatch = onMatch;
    this._onStatusChange = onStatusChange;

    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[ScrollEngine] Web Speech API not available');
      this._notifyStatus('error');
      return false;
    }

    try {
      this._recognition = new SpeechRecognition();
      this._recognition.continuous = true;
      this._recognition.interimResults = true;
      this._recognition.lang = 'en-US';

      this._recognition.onresult = (event) => {
        this._handleResult(event);
      };

      // Web Speech API auto-stops periodically — restart
      this._recognition.onend = () => {
        if (this._isListening) {
          this._restartTimer = setTimeout(() => {
            try {
              this._recognition.start();
            } catch (err) {
              console.warn('[ScrollEngine] Restart failed:', err.message);
              this._isListening = false;
              this._notifyStatus('error');
            }
          }, 100);
        }
      };

      this._recognition.onerror = (event) => {
        console.warn('[ScrollEngine] Recognition error:', event.error);
        // 'no-speech' and 'aborted' are non-fatal — recognition will restart via onend
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          this._isListening = false;
          this._notifyStatus('error');
        }
      };

      this._recognition.start();
      this._isListening = true;
      this._notifyStatus('listening');
      return true;
    } catch (err) {
      console.error('[ScrollEngine] Failed to start recognition:', err.message);
      this._notifyStatus('error');
      return false;
    }
  }

  /**
   * Stop voice recognition.
   */
  stopVoiceTracking() {
    this._isListening = false;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._recognition) {
      try {
        this._recognition.stop();
      } catch {}
      this._recognition = null;
    }
    this._transcript = '';
    this._notifyStatus('stopped');
  }

  /**
   * Get current sentence index.
   */
  get currentIndex() {
    return this._currentIdx;
  }

  /**
   * Get all prepared sentences.
   */
  get sentences() {
    return this._sentences;
  }

  /**
   * Set current sentence index (e.g. for section jumps).
   * @param {number} index
   */
  setCurrentIndex(index) {
    if (!this._sentences.length) return;
    this._currentIdx = Math.max(0, Math.min(index, this._sentences.length - 1));
  }

  /**
   * Reset to beginning.
   */
  reset() {
    this._currentIdx = 0;
    this._transcript = '';
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _handleResult(event) {
    // Concatenate all results into a running transcript
    let fullTranscript = '';
    for (let i = 0; i < event.results.length; i++) {
      fullTranscript += event.results[i][0].transcript + ' ';
    }
    this._transcript = fullTranscript.trim();

    const matchIdx = this._matchTranscript(this._transcript);
    if (matchIdx !== this._currentIdx) {
      this._currentIdx = matchIdx;
      if (this._onMatch) this._onMatch(matchIdx);
    }
  }

  /**
   * Fuzzy match transcript against sentences.
   * Uses last 20 words of transcript vs first 12 words of each sentence.
   * Forward-only: allows matching 1 sentence back but never earlier.
   *
   * @param {string} transcript
   * @returns {number} matched sentence index
   */
  _matchTranscript(transcript) {
    if (!this._sentences.length) return 0;

    const tWords = transcript.toLowerCase().split(/\s+/).filter(Boolean);
    const tail = tWords.length > TAIL_WORD_COUNT ? tWords.slice(-TAIL_WORD_COUNT) : tWords;

    if (!tail.length) return this._currentIdx;

    const tailSet = new Set(tail);

    let bestIdx = this._currentIdx;
    let bestScore = 0;

    // Allow matching 1 sentence back (re-check current), but never earlier
    const start = Math.max(0, this._currentIdx - 1);

    for (let i = start; i < this._sentences.length; i++) {
      const sWords = this._sentences[i].text.toLowerCase().split(/\s+/).filter(Boolean);
      const n = Math.min(sWords.length, SENTENCE_PREFIX_WORDS);
      const tailWindow = tail.length >= n ? tail.slice(-n) : tail;

      // Bigram Dice coefficient (closer to SequenceMatcher than Levenshtein)
      let score = ScrollEngine.bigramSimilarity(
        tailWindow.join(' '),
        sWords.slice(0, n).join(' ')
      );

      // Bonus: distinctive words (>min length chars) that appear in tail
      const distinctive = sWords.slice(0, n).filter(w => w.length > DISTINCTIVE_WORD_MIN_LENGTH);
      if (distinctive.length > 0) {
        const hits = distinctive.filter(w => tailSet.has(w)).length;
        score += DISTINCTIVE_WORD_BONUS * (hits / distinctive.length);
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    return bestScore > MATCH_THRESHOLD ? bestIdx : this._currentIdx;
  }

  _notifyStatus(status) {
    if (this._onStatusChange) this._onStatusChange(status);
  }

  // ── Static utilities ────────────────────────────────────────────────────

  /**
   * Bigram Dice coefficient — measures similarity between two strings.
   * Returns a value between 0 (no similarity) and 1 (identical).
   * Closer to Python's SequenceMatcher.ratio() than Levenshtein for
   * spoken word matching where exact ordering may vary.
   *
   * @param {string} a
   * @param {string} b
   * @returns {number} similarity score 0-1
   */
  static bigramSimilarity(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigramsA = ScrollEngine._getBigrams(a);
    const bigramsB = ScrollEngine._getBigrams(b);

    let intersection = 0;
    const bCopy = new Map(bigramsB);

    for (const [bigram, countA] of bigramsA) {
      const countB = bCopy.get(bigram) || 0;
      if (countB > 0) {
        intersection += Math.min(countA, countB);
        bCopy.set(bigram, countB - Math.min(countA, countB));
      }
    }

    const totalA = a.length - 1;
    const totalB = b.length - 1;

    return (2 * intersection) / (totalA + totalB);
  }

  /**
   * Extract character bigrams from a string as a frequency map.
   * @param {string} str
   * @returns {Map<string, number>}
   */
  static _getBigrams(str) {
    const bigrams = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  }

  /**
   * Parse section markers from text. Sections are delimited by `---` on its own line.
   * Returns array of { name, startOffset, sentenceIndex }.
   *
   * @param {string} text
   * @param {Array} sentences - from prepareSentences()
   * @returns {Array<{name: string, startOffset: number, sentenceIndex: number}>}
   */
  static parseSections(text, sentences) {
    if (!text || !sentences.length) return [];

    const sections = [];
    const lines = text.split('\n');
    let offset = 0;
    let sectionCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') {
        // Next non-empty line after --- is the section name
        let name = `Section ${++sectionCount}`;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim()) {
            // Use first ~30 chars of next line as section name
            name = lines[j].trim().substring(0, 30);
            if (lines[j].trim().length > 30) name += '...';
            break;
          }
        }

        // Find which sentence index this offset corresponds to
        const sectionOffset = offset + line.length + 1; // +1 for newline
        let sentenceIndex = sentences.length - 1; // default to last sentence
        for (let s = 0; s < sentences.length; s++) {
          if (sentences[s].startOffset >= sectionOffset) {
            sentenceIndex = s;
            break;
          }
        }

        sections.push({ name, startOffset: sectionOffset, sentenceIndex });
      }
      offset += line.length + 1; // +1 for newline
    }

    return sections;
  }

  /**
   * Estimate reading duration in seconds based on average speaking pace.
   *
   * @param {string} text
   * @returns {number} estimated seconds
   */
  static estimateDuration(text) {
    if (!text || !text.trim()) return 0;
    const wordCount = text.trim().split(/\s+/).length;
    return Math.round((wordCount / SPEAKING_WPM) * 60);
  }

  /**
   * Format seconds as MM:SS.
   * @param {number} seconds
   * @returns {string}
   */
  static formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

// Export for both Node.js (testing) and browser (Electron renderer).
// Use try-catch to avoid issues in strict Electron renderer contexts
// where Node.js globals may not be available.
try { module.exports = ScrollEngine; } catch (_) { /* browser context */ }
