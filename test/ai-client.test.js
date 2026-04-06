const assert = require('assert');

function createFreshAIClient() {
  const modulePath = require.resolve('../src/shared/ai-client');
  delete require.cache[modulePath];
  return require('../src/shared/ai-client');
}

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

async function testAsync(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`        ${err.message}`);
  }
}

console.log('\n=== AIClient Tests ===\n');

test('isAvailable is false when no API key is set', () => {
  delete process.env.GEMINI_API_KEY;
  const ai = createFreshAIClient();
  ai.init();
  assert.strictEqual(ai.isAvailable, false);
});

test('isAvailable is true when API key is set', () => {
  process.env.GEMINI_API_KEY = 'test-key-123';
  const ai = createFreshAIClient();
  ai.init();
  assert.strictEqual(ai.isAvailable, true);
  delete process.env.GEMINI_API_KEY;
});

// Async tests
(async () => {
  await testAsync('queryGemini returns { text: null, error } when no API key', async () => {
    delete process.env.GEMINI_API_KEY;
    const ai = createFreshAIClient();
    ai.init();
    const result = await ai.queryGemini('test prompt');
    assert.strictEqual(result.text, null);
    assert.ok(result.error);
    assert.ok(result.error.includes('not configured'));
  });

  await testAsync('generateCards returns { cards: [], checklist: [], error } when no API key', async () => {
    delete process.env.GEMINI_API_KEY;
    const ai = createFreshAIClient();
    ai.init();
    const result = await ai.generateCards('test context');
    assert.ok(Array.isArray(result.cards));
    assert.strictEqual(result.cards.length, 0);
    assert.ok(Array.isArray(result.checklist));
    assert.strictEqual(result.checklist.length, 0);
    assert.ok(result.error);
    assert.ok(result.error.includes('not configured'));
  });

  console.log(`\n${passCount}/${testCount} tests passed.\n`);
  if (passCount < testCount) process.exit(1);
})();
