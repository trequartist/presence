const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// We need a fresh StateManager instance for each test, not the singleton.
// Re-require the module to get the class constructor.
function createFreshStateManager() {
  // Clear the module cache to get a fresh singleton
  const modulePath = require.resolve('../src/shared/state-manager');
  delete require.cache[modulePath];
  const sm = require('../src/shared/state-manager');
  currentSm = sm;
  return sm;
}

let tmpDir;
let currentSm = null;
let testCount = 0;
let passCount = 0;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-test-'));
}

function teardown() {
  // Flush and cancel any pending debounced saves before removing the dir
  if (currentSm && currentSm._saveTimer) {
    clearTimeout(currentSm._saveTimer);
    currentSm._saveTimer = null;
  }
  currentSm = null;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

function test(name, fn) {
  testCount++;
  try {
    setup();
    fn();
    teardown();
    passCount++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    teardown();
    console.log(`  FAIL: ${name}`);
    console.log(`        ${err.message}`);
  }
}

console.log('\n=== StateManager Tests ===\n');

// --- init ---

test('init creates config directory if it does not exist', () => {
  const sm = createFreshStateManager();
  const configDir = path.join(tmpDir, 'nonexistent', 'nested');
  sm.init(configDir);
  assert.ok(fs.existsSync(configDir), 'Config directory should be created');
});

test('init creates state file with defaults when none exists', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  const state = sm.getState();
  assert.strictEqual(state.activeMode, 'coach');
  assert.strictEqual(typeof state.coach, 'object');
  assert.strictEqual(typeof state.prompter, 'object');
  assert.strictEqual(typeof state.prep, 'object');
});

test('init loads existing state file and merges with defaults', () => {
  const sm = createFreshStateManager();
  // Write a partial state file
  const stateFile = path.join(tmpDir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    activeMode: 'prompter',
    coach: { notes: 'my notes' }
  }));
  sm.init(tmpDir);
  const state = sm.getState();
  assert.strictEqual(state.activeMode, 'prompter');
  assert.strictEqual(state.coach.notes, 'my notes');
  // Defaults should be merged in
  assert.strictEqual(state.coach.sensitivity, 0.5);
  assert.strictEqual(typeof state.prompter.speed, 'number');
});

test('init handles corrupted state file gracefully', () => {
  const sm = createFreshStateManager();
  const stateFile = path.join(tmpDir, 'state.json');
  fs.writeFileSync(stateFile, 'NOT VALID JSON {{{');
  sm.init(tmpDir);
  const state = sm.getState();
  // Should fall back to defaults
  assert.strictEqual(state.activeMode, 'coach');
});

// --- getState ---

test('getState returns a deep copy, not a reference', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  const state1 = sm.getState();
  state1.activeMode = 'MUTATED';
  state1.coach.notes = 'MUTATED';
  const state2 = sm.getState();
  assert.strictEqual(state2.activeMode, 'coach', 'Mutation should not affect internal state');
  assert.strictEqual(state2.coach.notes, '', 'Nested mutation should not affect internal state');
});

// --- updateState ---

test('updateState deep merges partial updates', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ coach: { notes: 'updated notes' } });
  const state = sm.getState();
  assert.strictEqual(state.coach.notes, 'updated notes');
  // Other coach fields should be preserved
  assert.strictEqual(state.coach.sensitivity, 0.5);
  assert.strictEqual(state.coach.monologueWarnSec, 60);
});

test('updateState replaces arrays (does not merge them)', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ coach: { prepCards: [{ title: 'Card 1', body: 'Body 1' }] } });
  const state = sm.getState();
  assert.strictEqual(state.coach.prepCards.length, 1);
  assert.strictEqual(state.coach.prepCards[0].title, 'Card 1');
});

test('updateState handles top-level field changes', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ activeMode: 'prep' });
  assert.strictEqual(sm.getState().activeMode, 'prep');
});

test('updateState handles nested overlayBounds update', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ coach: { overlayBounds: { x: 200, y: 300 } } });
  const state = sm.getState();
  assert.strictEqual(state.coach.overlayBounds.x, 200);
  assert.strictEqual(state.coach.overlayBounds.y, 300);
  // width and height should be preserved from defaults
  assert.strictEqual(state.coach.overlayBounds.width, 640);
  assert.strictEqual(state.coach.overlayBounds.height, 200);
});

// --- onStateChange ---

test('onStateChange listener is called on updateState', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  let callCount = 0;
  let receivedState = null;
  sm.onStateChange((state) => {
    callCount++;
    receivedState = state;
  });
  sm.updateState({ activeMode: 'prompter' });
  assert.strictEqual(callCount, 1);
  assert.strictEqual(receivedState.activeMode, 'prompter');
});

test('onStateChange returns unsubscribe function', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  let callCount = 0;
  const unsub = sm.onStateChange(() => { callCount++; });
  sm.updateState({ activeMode: 'prompter' });
  assert.strictEqual(callCount, 1);
  unsub();
  sm.updateState({ activeMode: 'prep' });
  assert.strictEqual(callCount, 1, 'Should not be called after unsubscribe');
});

test('onStateChange listener receives a copy, not a reference', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  let receivedState = null;
  sm.onStateChange((state) => { receivedState = state; });
  sm.updateState({ activeMode: 'prompter' });
  receivedState.activeMode = 'MUTATED';
  assert.strictEqual(sm.getState().activeMode, 'prompter', 'Mutation of received state should not affect internal state');
});

// --- flush ---

test('flush writes state to disk immediately', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ activeMode: 'prep' });
  // Debounced save hasn't fired yet, but flush should force it
  sm.flush();
  const stateFile = path.join(tmpDir, 'state.json');
  const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  assert.strictEqual(onDisk.activeMode, 'prep');
});

// --- debounce ---

test('flush after updateState persists the latest state', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ activeMode: 'prompter' });
  const stateFile = path.join(tmpDir, 'state.json');
  // flush forces immediate write regardless of debounce timer
  sm.flush();
  const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  assert.strictEqual(onDisk.activeMode, 'prompter');
});

// --- edge cases ---

test('multiple rapid updates are merged correctly', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({ coach: { notes: 'first' } });
  sm.updateState({ coach: { sensitivity: 0.8 } });
  sm.updateState({ activeMode: 'prompter' });
  const state = sm.getState();
  assert.strictEqual(state.coach.notes, 'first');
  assert.strictEqual(state.coach.sensitivity, 0.8);
  assert.strictEqual(state.activeMode, 'prompter');
});

test('partial overlayBounds are preserved correctly through deep merge', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  // Simulate a partial overlayBounds (e.g. from corrupted state or older version)
  sm.updateState({ coach: { overlayBounds: { x: 50, y: 60 } } });
  const state = sm.getState();
  // x and y should be updated
  assert.strictEqual(state.coach.overlayBounds.x, 50);
  assert.strictEqual(state.coach.overlayBounds.y, 60);
  // width and height should be preserved from defaults
  assert.strictEqual(state.coach.overlayBounds.width, 640);
  assert.strictEqual(state.coach.overlayBounds.height, 200);
});

test('updateState with empty object does not break state', () => {
  const sm = createFreshStateManager();
  sm.init(tmpDir);
  sm.updateState({});
  const state = sm.getState();
  assert.strictEqual(state.activeMode, 'coach');
  assert.strictEqual(state.coach.sensitivity, 0.5);
});

// --- Summary ---

console.log(`\n${passCount}/${testCount} tests passed.\n`);
if (passCount < testCount) {
  process.exit(1);
}
