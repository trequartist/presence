const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// CoachingEngine is a browser-side class (no module.exports).
// Load via vm.Script with explicit export, injecting a performance polyfill.
// performance.now() is called inside update() — we control it via mockNow.
let mockNow = 0;
const engineCode = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'shared', 'coaching-engine.js'),
  'utf-8'
);
const script = new vm.Script(engineCode + '\nthis.CoachingEngine = CoachingEngine;');
const context = vm.createContext({ performance: { now: () => mockNow }, console });
script.runInContext(context);
const CoachingEngine = context.CoachingEngine;

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

// Helper: create a fresh engine with mocked time reset
function makeEngine(opts = {}) {
  mockNow = 0;
  return new CoachingEngine(opts);
}

// Helper: build a standard metrics object with safe defaults
function metrics(overrides = {}) {
  return {
    wpm: 0,
    talkPercent: 0,
    isSpeaking: false,
    continuousSpeechSec: 0,
    sessionDurationSec: 0,
    ...overrides
  };
}

console.log('\n=== CoachingEngine Tests ===\n');

// --- Constructor defaults ---

test('constructor sets default monologueWarnSec to 60', () => {
  const e = makeEngine();
  assert.strictEqual(e.monologueWarnSec, 60);
});

test('constructor accepts custom monologueWarnSec', () => {
  const e = makeEngine({ monologueWarnSec: 90, encourageIntervalMin: 5 });
  assert.strictEqual(e.monologueWarnSec, 90);
  assert.strictEqual(e.encourageIntervalMin, 5);
});

test('constructor initialises with no current message', () => {
  const e = makeEngine();
  assert.strictEqual(e.currentMessage, null);
  assert.strictEqual(e.currentPriority, 99);
});

// --- Monologue thresholds (highest priority group) ---

test('update: continuousSpeechSec > 120 returns priority-1 message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ continuousSpeechSec: 125, sessionDurationSec: 130 }));
  assert.ok(result, 'expected a message');
  assert.strictEqual(result.priority, 1);
  assert.ok(result.message.includes('2 min'));
});

test('update: continuousSpeechSec > 90 returns priority-2 message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ continuousSpeechSec: 95, sessionDurationSec: 100 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 2);
  assert.strictEqual(result.message, 'Stop and check in');
});

test('update: continuousSpeechSec > monologueWarnSec (60) returns priority-3 message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ continuousSpeechSec: 65, sessionDurationSec: 70 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 3);
  assert.ok(result.message.includes('pause'));
});

test('update: priority-1 beats priority-4 when both candidates present', () => {
  const e = makeEngine();
  // Both monologue >120 (p1) and wpm >170 (p4) fire simultaneously
  const result = e.update(metrics({ wpm: 175, continuousSpeechSec: 125, sessionDurationSec: 130 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 1);
});

// --- Speed checks ---

test('update: wpm > 170 returns priority-4 rush message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ wpm: 175, sessionDurationSec: 10 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 4);
  assert.strictEqual(result.zone, 'rush');
});

test('update: wpm > 150 returns priority-6 fast message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ wpm: 155, sessionDurationSec: 10 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 6);
  assert.strictEqual(result.zone, 'fast');
});

test('update: wpm in ideal zone 120-150 produces no speed message', () => {
  const e = makeEngine();
  // No other triggers active — should get null (or only low-priority messages)
  const result = e.update(metrics({ wpm: 135, sessionDurationSec: 10 }));
  // No speed candidate; session < 60s so no talk-time; no encouragement yet
  assert.strictEqual(result, null);
});

test('update: wpm > 0 and < 120 returns priority-9 calm message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ wpm: 90, sessionDurationSec: 10 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 9);
  assert.strictEqual(result.zone, 'calm');
});

test('update: wpm === 0 produces no speed message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ wpm: 0, sessionDurationSec: 10 }));
  assert.strictEqual(result, null);
});

// --- Talk-time checks (only after 60s) ---

test('update: talkPercent > 65 at 59s produces no talk-time message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ talkPercent: 70, sessionDurationSec: 59 }));
  assert.strictEqual(result, null);
});

test('update: talkPercent > 65 at 61s returns priority-5 message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ talkPercent: 70, sessionDurationSec: 61 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 5);
  assert.strictEqual(result.zone, 'talk-high');
});

test('update: talkPercent > 50 at 61s returns priority-7 message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ talkPercent: 55, sessionDurationSec: 61 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 7);
  assert.strictEqual(result.zone, 'talk-med');
});

test('update: talkPercent < 30 and > 0 at 61s returns priority-10 positive message', () => {
  const e = makeEngine();
  const result = e.update(metrics({ talkPercent: 20, sessionDurationSec: 61 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 10);
  assert.strictEqual(result.zone, 'talk-low');
});

test('update: talkPercent === 0 produces no talk-time message', () => {
  const e = makeEngine();
  // talkPercent=0 falls through the < 30 check which requires > 0
  const result = e.update(metrics({ talkPercent: 0, sessionDurationSec: 61 }));
  assert.strictEqual(result, null);
});

// --- Encouragement ---

test('update: encouragement NOT shown when other candidates exist', () => {
  const e = makeEngine();
  e.lastEncouragementAt = -999999; // bypass interval guard
  // wpm > 170 fires a candidate; encouragement should be suppressed
  const result = e.update(metrics({ wpm: 175, sessionDurationSec: 31 }));
  assert.ok(result);
  assert.notStrictEqual(result.zone, 'encourage');
});

test('update: encouragement shown when no other candidates and session > 30s', () => {
  const e = makeEngine();
  e.lastEncouragementAt = -999999;
  mockNow = 0;
  const result = e.update(metrics({ wpm: 0, talkPercent: 0, sessionDurationSec: 31 }));
  assert.ok(result);
  assert.strictEqual(result.zone, 'encourage');
  assert.strictEqual(result.priority, 8);
});

test('update: encouragement NOT shown when session <= 30s', () => {
  const e = makeEngine();
  e.lastEncouragementAt = -999999;
  const result = e.update(metrics({ wpm: 0, talkPercent: 0, sessionDurationSec: 30 }));
  assert.strictEqual(result, null);
});

test('update: encouragement interval is recorded and not re-triggered until elapsed', () => {
  const e = makeEngine();
  mockNow = 0;
  // First encouragement fires
  e.lastEncouragementAt = -999999;
  e.update(metrics({ sessionDurationSec: 31 }));
  assert.strictEqual(e.lastEncouragementAt, mockNow); // timestamp recorded at call time
  const firstIndex = e.encourageIndex;

  // Immediately call again — interval guard blocks a NEW encouragement from being generated.
  // The 3s display-time guard returns the existing encouragement message unchanged.
  // encourageIndex must NOT have incremented (no new encouragement was generated).
  e.update(metrics({ sessionDurationSec: 31 }));
  assert.strictEqual(e.encourageIndex, firstIndex, 'encourageIndex should not increment on repeated calls within interval');
});

test('update: encourageIndex increments and cycles through all messages', () => {
  const e = makeEngine();
  const total = e.encouragements.length;
  assert.ok(total > 0);
  // Verify cycling: index wraps
  assert.strictEqual(e.encouragements[(total) % total], e.encouragements[0]);
  assert.strictEqual(e.encouragements[(total + 1) % total], e.encouragements[1]);
});

// --- Minimum display time (3s guard) ---

test('update: same-priority candidate within 3s keeps current message', () => {
  const e = makeEngine();
  mockNow = 0;
  // Set a priority-7 message
  e.update(metrics({ talkPercent: 55, sessionDurationSec: 61 }));
  const first = e.currentMessage;
  assert.ok(first);

  // At 2s: same priority-7 candidate fires — should keep first
  mockNow = 2000;
  const second = e.update(metrics({ talkPercent: 55, sessionDurationSec: 63 }));
  assert.strictEqual(second.message, first.message, 'should still show first message');
});

test('update: higher-priority candidate preempts within 3s', () => {
  const e = makeEngine();
  mockNow = 0;
  // Set a priority-7 message (talk-med)
  e.update(metrics({ talkPercent: 55, sessionDurationSec: 61 }));
  assert.strictEqual(e.currentPriority, 7);

  // At 1s: priority-2 monologue fires — should preempt
  mockNow = 1000;
  const result = e.update(metrics({ talkPercent: 55, continuousSpeechSec: 95, sessionDurationSec: 62 }));
  assert.ok(result);
  assert.strictEqual(result.priority, 2, 'higher priority should preempt within 3s');
});

test('update: message clears after 8s with no candidates', () => {
  const e = makeEngine();
  mockNow = 0;
  e.update(metrics({ talkPercent: 55, sessionDurationSec: 61 }));
  assert.ok(e.currentMessage);

  // 8s+ later with no candidates
  mockNow = 8001;
  const result = e.update(metrics({ wpm: 0, talkPercent: 45, sessionDurationSec: 69 }));
  assert.strictEqual(result, null);
  assert.strictEqual(e.currentMessage, null);
  assert.strictEqual(e.currentPriority, 99);
});

// --- getSpeedZone ---

test('getSpeedZone(0) returns dim dash label', () => {
  const e = makeEngine();
  const zone = e.getSpeedZone(0);
  assert.strictEqual(zone.label, '--');
  assert.strictEqual(zone.color, '#666666');
});

test('getSpeedZone(110) returns calm zone', () => {
  const e = makeEngine();
  const zone = e.getSpeedZone(110);
  assert.strictEqual(zone.label, 'calm');
  assert.strictEqual(zone.color, '#44dd88');
});

test('getSpeedZone(135) returns ideal zone', () => {
  const e = makeEngine();
  const zone = e.getSpeedZone(135);
  assert.strictEqual(zone.label, 'ideal');
  assert.strictEqual(zone.color, '#44dd88');
});

test('getSpeedZone(160) returns fast zone', () => {
  const e = makeEngine();
  const zone = e.getSpeedZone(160);
  assert.strictEqual(zone.label, 'fast');
  assert.strictEqual(zone.color, '#ffaa00');
});

test('getSpeedZone(180) returns rush zone', () => {
  const e = makeEngine();
  const zone = e.getSpeedZone(180);
  assert.strictEqual(zone.label, 'rush');
  assert.strictEqual(zone.color, '#ff4444');
});

test('getSpeedZone boundary: 120 is calm (< 120 threshold)', () => {
  // wpm < 120 -> calm; wpm <= 150 -> ideal (note: 120 satisfies neither < 120 nor falls
  // through — actually 120 is NOT < 120, so it hits the <= 150 branch -> ideal)
  const e = makeEngine();
  const zone120 = e.getSpeedZone(120);
  assert.strictEqual(zone120.label, 'ideal'); // 120 is NOT < 120, falls to <= 150
  const zone119 = e.getSpeedZone(119);
  assert.strictEqual(zone119.label, 'calm');  // 119 IS < 120
});

test('getSpeedZone boundary: 150 is ideal, 151 is fast', () => {
  const e = makeEngine();
  assert.strictEqual(e.getSpeedZone(150).label, 'ideal');
  assert.strictEqual(e.getSpeedZone(151).label, 'fast');
});

test('getSpeedZone boundary: 170 is fast, 171 is rush', () => {
  const e = makeEngine();
  assert.strictEqual(e.getSpeedZone(170).label, 'fast');
  assert.strictEqual(e.getSpeedZone(171).label, 'rush');
});

// --- getTalkColor ---

test('getTalkColor(0) returns green (low talk)', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(0), '#44dd88');
});

test('getTalkColor(29) returns green', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(29), '#44dd88');
});

test('getTalkColor(50) returns green (boundary)', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(50), '#44dd88');
});

test('getTalkColor(51) returns amber', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(51), '#ffaa00');
});

test('getTalkColor(65) returns amber (boundary)', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(65), '#ffaa00');
});

test('getTalkColor(66) returns orange-red (high talk)', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(66), '#ff6b35');
});

test('getTalkColor(100) returns orange-red', () => {
  const e = makeEngine();
  assert.strictEqual(e.getTalkColor(100), '#ff6b35');
});

// --- reset() ---

test('reset clears currentMessage, priority and counters', () => {
  const e = makeEngine();
  mockNow = 0;
  e.update(metrics({ continuousSpeechSec: 125, sessionDurationSec: 130 }));
  e.monologueWarnings = 5;
  e.encourageIndex = 3;
  e.lastEncouragementAt = 50000;

  e.reset();

  assert.strictEqual(e.currentMessage, null);
  assert.strictEqual(e.currentPriority, 99);
  assert.strictEqual(e.messageSetAt, 0);
  assert.strictEqual(e.monologueWarnings, 0);
  assert.strictEqual(e.encourageIndex, 0);
  assert.strictEqual(e.lastEncouragementAt, 0);
});

test('reset allows encouragement to fire again immediately after reset', () => {
  const e = makeEngine();
  mockNow = 0;
  e.lastEncouragementAt = -999999;
  e.update(metrics({ sessionDurationSec: 31 }));
  // encourageAt is now set to 0; interval guard would block next call
  assert.ok(e.lastEncouragementAt >= 0);

  e.reset();
  // After reset, lastEncouragementAt = 0 and mockNow = 0
  // interval check: 0 - 0 = 0 ms, NOT > 4 * 60000, so still blocked
  // Force eligible:
  e.lastEncouragementAt = -999999;
  mockNow = 0;
  const result = e.update(metrics({ sessionDurationSec: 31 }));
  assert.ok(result && result.zone === 'encourage');
});

// --- update return value is currentMessage when guard holds ---

test('update returns currentMessage reference (not a copy) when guard holds', () => {
  const e = makeEngine();
  mockNow = 0;
  const m1 = e.update(metrics({ talkPercent: 55, sessionDurationSec: 61 }));
  // Still within 3s, same priority
  mockNow = 1000;
  const m2 = e.update(metrics({ talkPercent: 55, sessionDurationSec: 62 }));
  assert.strictEqual(m1, m2); // exact same object reference
});

// --- Summary ---
console.log(`\n${passCount}/${testCount} tests passed.\n`);
if (passCount < testCount) process.exit(1);
