const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load coaching engine (browser-side class, no module.exports)
const engineCode = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'shared', 'coaching-engine.js'),
  'utf-8'
);
const script = new vm.Script(engineCode + '\nthis.CoachingEngine = CoachingEngine;');
const context = vm.createContext({
  performance: { now: () => Date.now() },
  console
});
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

console.log('\n=== CoachingEngine Tests ===\n');

// --- getSpeedZone ---

test('getSpeedZone returns -- for 0 wpm', () => {
  const engine = new CoachingEngine();
  const result = engine.getSpeedZone(0);
  assert.strictEqual(result.label, '--');
  assert.strictEqual(result.color, '#666666');
});

test('getSpeedZone returns calm for < 120 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(100).label, 'calm');
  assert.strictEqual(engine.getSpeedZone(119).label, 'calm');
});

test('getSpeedZone returns ideal for 120-150 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(120).label, 'ideal');
  assert.strictEqual(engine.getSpeedZone(150).label, 'ideal');
});

test('getSpeedZone returns fast for 151-170 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(151).label, 'fast');
  assert.strictEqual(engine.getSpeedZone(170).label, 'fast');
});

test('getSpeedZone returns rush for > 170 wpm', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getSpeedZone(171).label, 'rush');
  assert.strictEqual(engine.getSpeedZone(200).label, 'rush');
});

// --- getTalkColor ---

test('getTalkColor returns green for <= 50%', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(20), '#44dd88');
  assert.strictEqual(engine.getTalkColor(50), '#44dd88');
});

test('getTalkColor returns amber for 51-65%', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(55), '#ffaa00');
  assert.strictEqual(engine.getTalkColor(65), '#ffaa00');
});

test('getTalkColor returns orange for > 65%', () => {
  const engine = new CoachingEngine();
  assert.strictEqual(engine.getTalkColor(70), '#ff6b35');
  assert.strictEqual(engine.getTalkColor(90), '#ff6b35');
});

// --- update: monologue checks ---

test('update returns priority 1 for > 120s continuous speech', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 130, wpm: 140, talkPercent: 50, sessionDurationSec: 200
  });
  assert.ok(result);
  assert.strictEqual(result.priority, 1);
  assert.strictEqual(result.zone, 'monologue');
});

test('update returns priority 2 for > 90s continuous speech', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 95, wpm: 140, talkPercent: 50, sessionDurationSec: 200
  });
  assert.ok(result);
  assert.strictEqual(result.priority, 2);
});

test('update returns priority 3 for > 60s continuous speech (default threshold)', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 65, wpm: 140, talkPercent: 50, sessionDurationSec: 200
  });
  assert.ok(result);
  assert.strictEqual(result.priority, 3);
});

// --- update: speed checks ---

test('update returns rush warning for > 170 wpm', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10, wpm: 180, talkPercent: 50, sessionDurationSec: 200
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'rush');
  assert.strictEqual(result.priority, 4);
});

test('update returns fast warning for 151-170 wpm', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10, wpm: 160, talkPercent: 50, sessionDurationSec: 200
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'fast');
  assert.strictEqual(result.priority, 6);
});

test('update returns good pace for < 120 wpm', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10, wpm: 100, talkPercent: 40, sessionDurationSec: 30
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'calm');
  assert.strictEqual(result.priority, 9);
});

// --- update: talk-time checks (only after 60s) ---

test('update returns talk-high for > 65% after 60s', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10, wpm: 140, talkPercent: 70, sessionDurationSec: 120
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'talk-high');
  assert.strictEqual(result.priority, 5);
});

test('update does not check talk-time before 60s', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 10, wpm: 140, talkPercent: 80, sessionDurationSec: 30
  });
  // Should not return talk-high since session < 60s
  assert.ok(!result || result.zone !== 'talk-high');
});

// --- update: priority ordering ---

test('monologue takes priority over speed', () => {
  const engine = new CoachingEngine();
  const result = engine.update({
    continuousSpeechSec: 130, wpm: 180, talkPercent: 70, sessionDurationSec: 200
  });
  assert.ok(result);
  assert.strictEqual(result.priority, 1); // monologue > rush
});

// --- reset ---

test('reset clears all state', () => {
  const engine = new CoachingEngine();
  engine.update({ continuousSpeechSec: 130, wpm: 180, talkPercent: 70, sessionDurationSec: 200 });
  assert.ok(engine.currentMessage);

  engine.reset();
  assert.strictEqual(engine.currentMessage, null);
  assert.strictEqual(engine.currentPriority, 99);
  assert.strictEqual(engine.monologueWarnings, 0);
});

// --- custom options ---

test('custom monologueWarnSec threshold is respected', () => {
  const engine = new CoachingEngine({ monologueWarnSec: 30 });
  const result = engine.update({
    continuousSpeechSec: 35, wpm: 140, talkPercent: 50, sessionDurationSec: 100
  });
  assert.ok(result);
  assert.strictEqual(result.zone, 'monologue');
});

// --- Summary ---
console.log(`\n${passCount}/${testCount} tests passed.\n`);
if (passCount < testCount) process.exit(1);
