// audio-engine.js — Voice Activity Detection + Syllable Rate → WPM
// Runs in renderer process (overlay.html). Uses Web Audio API only.

class AudioEngine {
  constructor(options = {}) {
    this.sensitivity = options.sensitivity || 0.5;
    this.onUpdate = options.onUpdate || (() => {});

    // Audio nodes
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.isRunning = false;

    // VAD state
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.totalSpeechMs = 0;
    this.sessionStartTime = 0;
    this.continuousSpeechStart = 0;
    this.lastSilenceStart = 0;
    this.gapThresholdMs = 2000; // gaps < 2s count as continuous speech

    // Syllable detection
    this.peakTimestamps = [];
    this.lastRms = 0;
    this.wasRising = false;

    // Smoothed WPM
    this.wpmSmoothed = 0;
    this.wpmHistory = [];

    // RAF
    this._rafId = null;
    this._lastProcess = 0;

    // Buffers (reuse to avoid GC)
    this._freqData = null;
    this._timeData = null;
  }

  async start() {
    if (this.isRunning) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Mic access denied:', err);
      return false;
    }

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.3;
    source.connect(this.analyser);
    // Don't connect to destination — we never play back mic audio

    this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this._timeData = new Uint8Array(this.analyser.fftSize);

    this.isRunning = true;
    this.sessionStartTime = performance.now();
    this.totalSpeechMs = 0;
    this.isSpeaking = false;
    this.continuousSpeechStart = 0;
    this.lastSilenceStart = this.sessionStartTime;
    this.peakTimestamps = [];
    this.wpmSmoothed = 0;
    this.wpmHistory = [];
    this._lastProcess = 0;

    this._tick();
    return true;
  }

  stop() {
    this.isRunning = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);

    // Finalize speech if still speaking
    if (this.isSpeaking) {
      this.totalSpeechMs += performance.now() - this.speechStartTime;
      this.isSpeaking = false;
    }

    // Build summary
    const sessionMs = performance.now() - this.sessionStartTime;
    const avgWpm = this.wpmHistory.length > 0
      ? Math.round(this.wpmHistory.reduce((a, b) => a + b.wpm, 0) / this.wpmHistory.length)
      : 0;
    const peakWpm = this.wpmHistory.length > 0
      ? Math.max(...this.wpmHistory.map(h => h.wpm))
      : 0;

    const summary = {
      date: new Date().toISOString(),
      durationSec: Math.round(sessionMs / 1000),
      avgWpm,
      peakWpm,
      talkPercent: sessionMs > 0 ? Math.round((this.totalSpeechMs / sessionMs) * 100) : 0
    };

    // Cleanup
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    return summary;
  }

  setSensitivity(val) {
    this.sensitivity = val;
  }

  _tick() {
    if (!this.isRunning) return;

    const now = performance.now();

    // Throttle to ~20fps
    if (now - this._lastProcess < 50) {
      this._rafId = requestAnimationFrame(() => this._tick());
      return;
    }
    this._lastProcess = now;

    this.analyser.getByteFrequencyData(this._freqData);
    this.analyser.getByteTimeDomainData(this._timeData);

    const speaking = this._detectSpeech(this._freqData);
    this._updateSpeechTracking(speaking, now);

    // Syllable rate only when speaking
    let rawWpm = 0;
    if (speaking) {
      rawWpm = this._estimateWpm(this._timeData, now);
    }

    // Exponential smoothing — heavy alpha for stability (updates feel ~1-2s)
    if (rawWpm > 0) {
      this.wpmSmoothed = this.wpmSmoothed * 0.95 + rawWpm * 0.05;
    } else if (!speaking) {
      this.wpmSmoothed *= 0.98;
      if (this.wpmSmoothed < 5) this.wpmSmoothed = 0;
    }

    // Only update the displayed WPM every 1.5s to avoid jitter
    if (!this._lastWpmEmit) this._lastWpmEmit = 0;
    if (!this._displayWpm) this._displayWpm = 0;
    if (now - this._lastWpmEmit > 1500) {
      this._displayWpm = Math.round(this.wpmSmoothed);
      this._lastWpmEmit = now;
    }

    // Snapshot every 5s for history
    if (this.wpmHistory.length === 0 || now - this.wpmHistory[this.wpmHistory.length - 1].t > 5000) {
      this.wpmHistory.push({ t: now, wpm: Math.round(this.wpmSmoothed) });
      // Cap history at 720 entries (1 hour at 5s intervals)
      if (this.wpmHistory.length > 720) this.wpmHistory.shift();
    }

    // Compute metrics
    const sessionMs = now - this.sessionStartTime;
    const currentSpeechMs = this.totalSpeechMs + (this.isSpeaking ? now - this.speechStartTime : 0);
    const talkPercent = sessionMs > 1000 ? (currentSpeechMs / sessionMs) * 100 : 0;

    const continuousMs = this._getContinuousSpeechMs(now);

    this.onUpdate({
      wpm: this._displayWpm,
      talkPercent: Math.round(talkPercent),
      isSpeaking: speaking,
      continuousSpeechSec: Math.round(continuousMs / 1000),
      sessionDurationSec: Math.round(sessionMs / 1000)
    });

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  _detectSpeech(freqData) {
    // Average energy in speech band (300-3000 Hz)
    const binWidth = this.audioContext.sampleRate / this.analyser.fftSize;
    const lowBin = Math.floor(300 / binWidth);
    const highBin = Math.min(Math.ceil(3000 / binWidth), freqData.length - 1);

    let sum = 0;
    for (let i = lowBin; i <= highBin; i++) {
      sum += freqData[i];
    }
    const avg = sum / (highBin - lowBin + 1);

    // Threshold scaled by sensitivity (higher sensitivity = lower threshold = more detection)
    const threshold = 20 + (1 - this.sensitivity) * 30;
    return avg > threshold;
  }

  _updateSpeechTracking(speaking, now) {
    if (speaking && !this.isSpeaking) {
      // Transition: silence → speech
      this.isSpeaking = true;
      this.speechStartTime = now;

      const gapMs = now - this.lastSilenceStart;
      if (gapMs > this.gapThresholdMs || this.continuousSpeechStart === 0) {
        // Long gap — reset continuous speech
        this.continuousSpeechStart = now;
      }
      // Short gap — continuous speech continues from where it started
    } else if (!speaking && this.isSpeaking) {
      // Transition: speech → silence
      this.isSpeaking = false;
      this.totalSpeechMs += now - this.speechStartTime;
      this.lastSilenceStart = now;
    }
  }

  _getContinuousSpeechMs(now) {
    if (!this.continuousSpeechStart) return 0;

    if (this.isSpeaking) {
      return now - this.continuousSpeechStart;
    }

    // If in a short gap, still count as continuous
    const silenceMs = now - this.lastSilenceStart;
    if (silenceMs < this.gapThresholdMs) {
      return this.lastSilenceStart - this.continuousSpeechStart;
    }

    // Long gap — no continuous speech
    return 0;
  }

  _estimateWpm(timeData, now) {
    // Compute RMS of current frame
    let sumSq = 0;
    for (let i = 0; i < timeData.length; i++) {
      const sample = (timeData[i] - 128) / 128;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / timeData.length);

    // Peak detection: rising-then-falling = syllable nucleus
    const isRising = rms > this.lastRms * 1.08;

    if (this.wasRising && !isRising && rms > 0.015) {
      this.peakTimestamps.push(now);
    }

    this.wasRising = isRising;
    this.lastRms = rms;

    // Keep peaks from last 5 seconds
    const windowMs = 5000;
    while (this.peakTimestamps.length > 0 && now - this.peakTimestamps[0] > windowMs) {
      this.peakTimestamps.shift();
    }

    if (this.peakTimestamps.length < 3) return 0;

    const span = (this.peakTimestamps[this.peakTimestamps.length - 1] - this.peakTimestamps[0]) / 1000;
    if (span < 0.5) return 0;

    const syllablesPerSec = (this.peakTimestamps.length - 1) / span;
    // English average: ~1.4 syllables per word
    return (syllablesPerSec * 60) / 1.4;
  }
}
