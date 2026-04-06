const assert = require('assert');
const fs = require('fs');
const path = require('path');

// coaching-engine.js defines a class in global scope (browser script, no module.exports).
// Wrap the source in a function that returns the class so we can import it.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'coaching-engine.js'), 'utf-8');
const CoachingEngine = new Function('performance', src + '\nreturn CoachingEngine;')(
  { now: () => Date.now() }
);

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

console.log('\n=== CoachingEngine Tests ===\n');

// --- Constructor ---

test('constructor sets default options', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.monologueWarnSec, 60);
  assert.strictEqual(engine.encourageIntervalMin, 4);
  assert.strictEqual(engine.currentMessage, null);
  assert.strictEqual(engine.monologueWarnings, 0);
});

test('constructor accepts custom options', () => {
  const engine = new CoachingEngine({ monologueWarnSec: 45, encourageIntervalMin: 2 });
  assert.strictEqual(engine.monologueWarnSec, 45);
  assert.strictEqual(engine.encourageIntervalMin, 2);
});

// --- Monologue detection ---

test('update returns monologue warning when continuous speech exceeds threshold', () => {
  const engine = new CoachingEngine({ monologueWarnSec: 60 });
  const result = engine.update({
    continuousSpeechSec: 70,
    wpm: 130,
    talkPercent: 40,
    sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'monologue');
  assert.strictEqual(result.priority, 3);
});

test('update returns priority 2 monologue at 90+ seconds', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 95,
    wpm: 130,
    talkPercent: 40,
    sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'monologue');
  assert.strictEqual(result.priority, 2);
});

test('update returns priority 1 monologue at 120+ seconds', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 125,
    wpm: 130,
    talkPercent: 40,
    sessionDurationSec: 180
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'monologue');
  assert.strictEqual(result.priority, 1);
});

test('monologue warning uses custom threshold', () => {
  const engine = new CoachingEngine({ monologueWarnSec: 30 });
  const result = engine.update({
    continuousSpeechSec: 35,
    wpm: 130,
    talkPercent: 40,
    sessionDurationSec: 60
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'monologue');
});

// --- Speed checks ---

test('update returns rush warning when wpm > 170', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 180,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'rush');
  assert.strictEqual(result.priority, 4);
});

test('update returns fast warning when wpm 151-170', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 160,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'fast');
  assert.strictEqual(result.priority, 6);
});

test('update returns calm message when wpm < 120', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 100,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'calm');
  assert.strictEqual(result.priority, 9);
});

test('no speed message in ideal zone (120-150 wpm)', () => {
  const engine = new CoachingEngine();
  // Short session, no talk-time checks, ideal wpm — should get no message
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  assert.strictEqual(result, null);
});

// --- Talk-time checks ---

test('talk-time checks only activate after 60s', () => {
  const engine = new CoachingEngine();
  // High talk percent but short session — no talk-time message
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 80,
    sessionDurationSec: 30
  });
  assert.strictEqual(result, null);
});

test('high talk percent (>65%) triggers talk-high warning', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 70,
    sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'talk-high');
  assert.strictEqual(result.priority, 5);
});

test('medium talk percent (51-65%) triggers talk-med warning', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 55,
    sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'talk-med');
  assert.strictEqual(result.priority, 7);
});

test('low talk percent (<30%) shows listening message', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 20,
    sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'talk-low');
  assert.strictEqual(result.priority, 10);
});

// --- Priority system ---

test('monologue beats speed warning (lower priority number wins)', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 125,  // priority 1 monologue
    wpm: 180,                  // priority 4 rush
    talkPercent: 70,           // priority 5 talk-high
    sessionDurationSec: 180
  });
  assert.ok(result);
  assert.strictEqual(result.priority, 1);
  assert.strictEqual(result.zone, 'monologue');
});

test('speed warning beats talk-time warning', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 180,                  // priority 4 rush
    talkPercent: 70,           // priority 5 talk-high
    sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.priority, 4);
  assert.strictEqual(result.zone, 'rush');
});

// --- Minimum display time ---

test('message persists for at least 3 seconds', () => {
  const engine = new CoachingEngine();
  // First update: rush warning
  engine.update({
    continuousSpeechSec: 10,
    wpm: 180,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  // Immediately update with calm metrics — should still show rush
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 100,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'rush');
});

test('higher priority message can override within 3 seconds', () => {
  const engine = new CoachingEngine();
  // First: fast warning (priority 6)
  engine.update({
    continuousSpeechSec: 10,
    wpm: 160,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  // Immediately: rush warning (priority 4) — should override
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 180,
    talkPercent: 40,
    sessionDurationSec: 30
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'rush');
  assert.strictEqual(result.priority, 4);
});

// --- getSpeedZone ---

test('getSpeedZone returns -- for 0 wpm', () => {
  const engine = new CoachingEngine();
  const zone = engine.getSpeedZone(0);
  assert.strictEqual(zone.label, '--');
});

test('getSpeedZone returns calm for < 120 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(100).label, 'calm');
});

test('getSpeedZone returns ideal for 120-150 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(135).label, 'ideal');
});

test('getSpeedZone returns fast for 151-170 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(160).label, 'fast');
});

test('getSpeedZone returns rush for > 170 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(180).label, 'rush');
});

// --- getTalkColor ---

test('getTalkColor returns green for low talk percent', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(20), '#44dd88');
});

test('getTalkColor returns green for moderate talk percent (<=50)', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(45), '#44dd88');
});

test('getTalkColor returns amber for 51-65%', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(60), '#ffaa00');
});

test('getTalkColor returns orange for >65%', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(70), '#ff6b35');
});

// --- reset ---

test('reset clears all state', () => {
  const engine = new CoachingEngine();
  // Generate some state
  engine.update({
    continuousSpeechSec: 125,
    wpm: 180,
    talkPercent: 70,
    sessionDurationSec: 180
  });
  assert.ok(engine.currentMessage);
  assert.ok(engine.monologueWarnings > 0);

  engine.reset();
  assert.strictEqual(engine.currentMessage, null);
  assert.strictEqual(engine.currentPriority, 99);
  assert.strictEqual(engine.monologueWarnings, 0);
  assert.strictEqual(engine.encourageIndex, 0);
});

// --- Encouragement ---

test('encouragement only fires when no other candidates exist', () => {
  const engine = new CoachingEngine({ encourageIntervalMin: 0 }); // immediate
  // Ideal wpm, moderate talk, no monologue, session > 30s
  const result = engine.update({
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 40,
    sessionDurationSec: 60
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'encourage');
});

test('encouragement cycles through messages', () => {
  const engine = new CoachingEngine({ encourageIntervalMin: 0 });
  const metrics = {
    continuousSpeechSec: 10,
    wpm: 135,
    talkPercent: 40,
    sessionDurationSec: 60
  };

  // Force past the 3s minimum display time by manipulating messageSetAt
  const first = engine.update(metrics);
  assert.ok(first);
  assert.strictEqual(first.zone, 'encourage');
  const firstMsg = first.message;

  // Advance past min display time
  engine.messageSetAt = 0;
  engine.lastEncouragementAt = 0;

  const second = engine.update(metrics);
  assert.ok(second);
  assert.strictEqual(second.zone, 'encourage');
  assert.notStrictEqual(second.message, firstMsg);
});

console.log(`\n${passCount}/${testCount} tests passed.\n`);
if (passCount < testCount) process.exit(1);
