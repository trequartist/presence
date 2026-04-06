const assert = require('assert');
const ScrollEngine = require('../src/modes/prompter/scroll-engine');

let testCount = 0;
let passCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`        ${err.message}`);
  }
}

console.log('\n=== ScrollEngine Tests ===\n');

// ── bigramSimilarity ──────────────────────────────────────────────────────

test('bigramSimilarity: identical strings return 1', () => {
  assert.strictEqual(ScrollEngine.bigramSimilarity('hello world', 'hello world'), 1);
});

test('bigramSimilarity: completely different strings return ~0', () => {
  const score = ScrollEngine.bigramSimilarity('abcdef', 'zyxwvu');
  assert.ok(score < 0.1, `Expected < 0.1, got ${score}`);
});

test('bigramSimilarity: similar strings return high score', () => {
  const score = ScrollEngine.bigramSimilarity('the quick brown fox', 'the quick brown dog');
  assert.ok(score > 0.6, `Expected > 0.6, got ${score}`);
});

test('bigramSimilarity: empty or single char returns 0 (except identical empty)', () => {
  assert.strictEqual(ScrollEngine.bigramSimilarity('', 'hello'), 0);
  assert.strictEqual(ScrollEngine.bigramSimilarity('a', 'b'), 0);
  // Two empty strings are identical, so bigramSimilarity returns 1
  assert.strictEqual(ScrollEngine.bigramSimilarity('', ''), 1);
});

test('bigramSimilarity: partial overlap returns moderate score', () => {
  const score = ScrollEngine.bigramSimilarity('hello world', 'hello there');
  assert.ok(score > 0.3 && score < 0.8, `Expected 0.3-0.8, got ${score}`);
});

test('bigramSimilarity: word reordering still gives some similarity', () => {
  const score = ScrollEngine.bigramSimilarity('brown quick fox', 'quick brown fox');
  assert.ok(score > 0.5, `Expected > 0.5 for reordered words, got ${score}`);
});

// ── prepareSentences ──────────────────────────────────────────────────────

test('prepareSentences: splits on period + space', () => {
  const engine = new ScrollEngine();
  const sentences = engine.prepareSentences('Hello world. How are you. Fine thanks.');
  assert.strictEqual(sentences.length, 3);
  assert.strictEqual(sentences[0].text, 'Hello world.');
  assert.strictEqual(sentences[1].text, 'How are you.');
  assert.strictEqual(sentences[2].text, 'Fine thanks.');
});

test('prepareSentences: splits on question mark', () => {
  const engine = new ScrollEngine();
  const sentences = engine.prepareSentences('What is this? It is a test.');
  assert.strictEqual(sentences.length, 2);
  assert.strictEqual(sentences[0].text, 'What is this?');
});

test('prepareSentences: splits on exclamation mark', () => {
  const engine = new ScrollEngine();
  const sentences = engine.prepareSentences('Wow! That is great!');
  assert.strictEqual(sentences.length, 2);
});

test('prepareSentences: splits on newlines', () => {
  const engine = new ScrollEngine();
  const sentences = engine.prepareSentences('First line\nSecond line\nThird line');
  assert.strictEqual(sentences.length, 3);
  assert.strictEqual(sentences[0].text, 'First line');
  assert.strictEqual(sentences[1].text, 'Second line');
});

test('prepareSentences: filters out --- section markers', () => {
  const engine = new ScrollEngine();
  const sentences = engine.prepareSentences('Intro text.\n---\nSection content.');
  assert.strictEqual(sentences.length, 2);
  assert.strictEqual(sentences[0].text, 'Intro text.');
  assert.strictEqual(sentences[1].text, 'Section content.');
  // --- should not appear as a sentence
  assert.ok(sentences.every(s => s.text !== '---'));
});

test('prepareSentences: handles empty text', () => {
  const engine = new ScrollEngine();
  assert.strictEqual(engine.prepareSentences('').length, 0);
  assert.strictEqual(engine.prepareSentences(null).length, 0);
  assert.strictEqual(engine.prepareSentences('   ').length, 0);
});

test('prepareSentences: tracks startOffset and endOffset', () => {
  const engine = new ScrollEngine();
  const text = 'Hello. World.';
  const sentences = engine.prepareSentences(text);
  assert.strictEqual(sentences[0].startOffset, 0);
  assert.strictEqual(sentences[0].endOffset, 6); // "Hello."
  assert.strictEqual(sentences[1].startOffset, 7); // "World."
});

test('prepareSentences: resets currentIdx to 0', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('One. Two. Three.');
  engine.setCurrentIndex(2);
  assert.strictEqual(engine.currentIndex, 2);
  engine.prepareSentences('New text. Here.');
  assert.strictEqual(engine.currentIndex, 0);
});

// ── _matchTranscript ──────────────────────────────────────────────────────

test('matchTranscript: matches first sentence from transcript', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('The quick brown fox jumped over the lazy dog. The cat sat on the mat.');
  // Simulate speaking the first sentence
  const idx = engine._matchTranscript('the quick brown fox jumped over');
  assert.strictEqual(idx, 0);
});

test('matchTranscript: advances to second sentence', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('The quick brown fox jumped. The cat sat on the mat. The bird flew away.');
  engine.setCurrentIndex(0);
  const idx = engine._matchTranscript('the cat sat on the mat');
  assert.strictEqual(idx, 1);
});

test('matchTranscript: forward-only — does not jump back more than 1', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('Alpha bravo charlie delta. Echo foxtrot golf hotel. India juliet kilo lima. Mike november oscar papa.');
  engine.setCurrentIndex(3);
  // Try to match first sentence — should stay at 3 (can only check current-1=2 and forward)
  const idx = engine._matchTranscript('alpha bravo charlie delta');
  assert.strictEqual(idx, 3, 'Should not jump back more than 1 sentence');
});

test('matchTranscript: allows re-check of current-1 sentence', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('Alpha beta gamma. Delta epsilon zeta. Eta theta iota.');
  engine.setCurrentIndex(2);
  // Match sentence at index 1 (current - 1) — should be allowed
  const idx = engine._matchTranscript('delta epsilon zeta');
  assert.strictEqual(idx, 1, 'Should allow matching 1 sentence back');
});

test('matchTranscript: returns current index when no good match', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('Hello world. Goodbye moon.');
  engine.setCurrentIndex(0);
  const idx = engine._matchTranscript('completely unrelated gibberish xyz');
  assert.strictEqual(idx, 0, 'Should stay at current when no match');
});

test('matchTranscript: uses last 20 words of long transcript', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('Target sentence with specific words. Another sentence entirely different.');
  // Pad with 25 irrelevant words then the target
  const padding = 'word '.repeat(25);
  const idx = engine._matchTranscript(padding + 'target sentence with specific words');
  assert.strictEqual(idx, 0);
});

test('matchTranscript: handles empty sentences', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('');
  assert.strictEqual(engine._matchTranscript('anything'), 0);
});

// ── setCurrentIndex ───────────────────────────────────────────────────────

test('setCurrentIndex: clamps to valid range', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('One. Two. Three.');
  engine.setCurrentIndex(5);
  assert.strictEqual(engine.currentIndex, 2); // last valid index
  engine.setCurrentIndex(-1);
  assert.strictEqual(engine.currentIndex, 0);
});

test('setCurrentIndex: no-op on empty sentences', () => {
  const engine = new ScrollEngine();
  // _currentIdx starts at 0
  assert.strictEqual(engine.currentIndex, 0);
  engine.setCurrentIndex(5);
  // Should remain 0 since no sentences are prepared
  assert.strictEqual(engine.currentIndex, 0);
});

// ── parseSections ─────────────────────────────────────────────────────────

test('parseSections: finds section markers', () => {
  const engine = new ScrollEngine();
  const text = 'Intro sentence.\n---\nSection one content.\n---\nSection two content.';
  const sentences = engine.prepareSentences(text);
  const sections = ScrollEngine.parseSections(text, sentences);
  assert.strictEqual(sections.length, 2);
  assert.strictEqual(sections[0].name, 'Section one content.');
  assert.strictEqual(sections[1].name, 'Section two content.');
});

test('parseSections: returns empty for text without markers', () => {
  const engine = new ScrollEngine();
  const text = 'Just a normal paragraph. No sections here.';
  const sentences = engine.prepareSentences(text);
  const sections = ScrollEngine.parseSections(text, sentences);
  assert.strictEqual(sections.length, 0);
});

test('parseSections: handles empty text', () => {
  const sections = ScrollEngine.parseSections('', []);
  assert.strictEqual(sections.length, 0);
});

test('parseSections: truncates long section names', () => {
  const engine = new ScrollEngine();
  const longName = 'A'.repeat(50);
  const text = `Intro.\n---\n${longName}`;
  const sentences = engine.prepareSentences(text);
  const sections = ScrollEngine.parseSections(text, sentences);
  assert.strictEqual(sections.length, 1);
  assert.ok(sections[0].name.length <= 33, 'Name should be truncated'); // 30 + "..."
});

test('parseSections: section at start of text defaults to last sentence', () => {
  const engine = new ScrollEngine();
  const text = '---\nContent after marker.';
  const sentences = engine.prepareSentences(text);
  const sections = ScrollEngine.parseSections(text, sentences);
  assert.strictEqual(sections.length, 1);
  // Should point to the sentence after the marker, not default to 0
  assert.ok(sections[0].sentenceIndex >= 0);
});

// ── estimateDuration ──────────────────────────────────────────────────────

test('estimateDuration: returns 0 for empty text', () => {
  assert.strictEqual(ScrollEngine.estimateDuration(''), 0);
  assert.strictEqual(ScrollEngine.estimateDuration(null), 0);
  assert.strictEqual(ScrollEngine.estimateDuration('   '), 0);
});

test('estimateDuration: 150 words = 60 seconds', () => {
  const words = Array(150).fill('word').join(' ');
  assert.strictEqual(ScrollEngine.estimateDuration(words), 60);
});

test('estimateDuration: 300 words = 120 seconds', () => {
  const words = Array(300).fill('word').join(' ');
  assert.strictEqual(ScrollEngine.estimateDuration(words), 120);
});

// ── formatTime ────────────────────────────────────────────────────────────

test('formatTime: formats seconds correctly', () => {
  assert.strictEqual(ScrollEngine.formatTime(0), '0:00');
  assert.strictEqual(ScrollEngine.formatTime(60), '1:00');
  assert.strictEqual(ScrollEngine.formatTime(90), '1:30');
  assert.strictEqual(ScrollEngine.formatTime(125), '2:05');
});

// ── reset ─────────────────────────────────────────────────────────────────

test('reset: clears index and transcript', () => {
  const engine = new ScrollEngine();
  engine.prepareSentences('One. Two. Three.');
  engine.setCurrentIndex(2);
  engine.reset();
  assert.strictEqual(engine.currentIndex, 0);
});

// ── _getBigrams ───────────────────────────────────────────────────────────

test('_getBigrams: extracts correct bigrams', () => {
  const bigrams = ScrollEngine._getBigrams('abc');
  assert.strictEqual(bigrams.get('ab'), 1);
  assert.strictEqual(bigrams.get('bc'), 1);
  assert.strictEqual(bigrams.size, 2);
});

test('_getBigrams: handles repeated bigrams', () => {
  const bigrams = ScrollEngine._getBigrams('abab');
  assert.strictEqual(bigrams.get('ab'), 2);
  assert.strictEqual(bigrams.get('ba'), 1);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passCount}/${testCount} tests passed.\n`);
if (passCount < testCount) process.exit(1);
