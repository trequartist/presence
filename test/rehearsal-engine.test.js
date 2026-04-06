const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the rehearsal engine as a plain script (it's a browser-side class, no module.exports)
const engineCode = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modes', 'prep', 'rehearsal-engine.js'),
  'utf-8'
);
// Execute in current context to define the class
const script = new vm.Script(engineCode + '\nthis.RehearsalEngine = RehearsalEngine;');
const context = vm.createContext({ window: undefined, console });
script.runInContext(context);
const RehearsalEngine = context.RehearsalEngine;

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

// Mock queryAI that returns structured responses
function createMockQueryAI(responses) {
  let callIndex = 0;
  const calls = [];
  return {
    fn: async (prompt, opts) => {
      calls.push({ prompt, opts });
      const response = responses[callIndex] || { text: '{}', error: null };
      callIndex++;
      return response;
    },
    calls,
    reset: () => { callIndex = 0; calls.length = 0; }
  };
}

console.log('\n=== RehearsalEngine Tests ===\n');

// --- Constructor ---

test('constructor with no args creates engine with null queryAI', () => {
  // In Node.js, window is undefined, so _queryAI should be null
  const engine = new RehearsalEngine();
  assert.strictEqual(engine._queryAI, null);
});

test('constructor with custom queryAI stores it', () => {
  const mockFn = async () => ({ text: 'test', error: null });
  const engine = new RehearsalEngine({ queryAI: mockFn });
  assert.strictEqual(engine._queryAI, mockFn);
});

// --- setup ---

test('setup stores context and resets state', () => {
  const engine = new RehearsalEngine({ queryAI: async () => ({}) });
  engine._conversationHistory = [{ role: 'user', text: 'old' }];
  engine._fullTranscript = [{ role: 'user', text: 'old' }];
  engine._isActive = true;

  engine.setup({ title: 'Test Meeting', attendees: 'Alice' });

  assert.strictEqual(engine._context.title, 'Test Meeting');
  assert.strictEqual(engine._context.attendees, 'Alice');
  assert.strictEqual(engine._conversationHistory.length, 0);
  assert.strictEqual(engine._fullTranscript.length, 0);
  assert.strictEqual(engine._isActive, false);
});

// --- startRehearsal ---

test('startRehearsal sets meeting type and activates', () => {
  const engine = new RehearsalEngine({ queryAI: async () => ({}) });
  engine.setup({ title: 'Test' });
  engine.startRehearsal('interview');

  assert.strictEqual(engine._meetingType, 'interview');
  assert.strictEqual(engine._isActive, true);
  assert.ok(engine._systemPrompt.includes('interviewer'));
});

test('startRehearsal builds correct system prompt for each type', () => {
  const engine = new RehearsalEngine({ queryAI: async () => ({}) });
  engine.setup({ title: 'Test' });

  engine.startRehearsal('sales-pitch');
  assert.ok(engine._systemPrompt.includes('skeptical'));

  engine.startRehearsal('negotiation');
  assert.ok(engine._systemPrompt.includes('counterparty'));

  engine.startRehearsal('1-1-networking');
  assert.ok(engine._systemPrompt.includes('conversational'));

  engine.startRehearsal('general');
  assert.ok(engine._systemPrompt.includes('naturally'));
});

// --- generateBriefing ---

(async () => {
  await testAsync('generateBriefing returns parsed briefing on success', async () => {
    const mock = createMockQueryAI([{
      text: JSON.stringify({
        whoTheyAre: 'Alice is a PM',
        whatAbout: 'Product review',
        yourGoals: 'Get alignment',
        talkingPoints: ['Point 1', 'Point 2', 'Point 3']
      }),
      error: null
    }]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    engine.setup({ title: 'Review', attendees: 'Alice' });

    const result = await engine.generateBriefing({
      title: 'Review', attendees: 'Alice', meetingType: 'general'
    });

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.briefing.whoTheyAre, 'Alice is a PM');
    assert.strictEqual(result.briefing.talkingPoints.length, 3);
  });

  await testAsync('generateBriefing returns error when AI fails', async () => {
    const mock = createMockQueryAI([{
      text: null,
      error: 'API key not configured'
    }]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    const result = await engine.generateBriefing({ title: 'Test' });

    assert.ok(result.error);
    assert.strictEqual(result.briefing, null);
  });

  await testAsync('generateBriefing handles malformed JSON', async () => {
    const mock = createMockQueryAI([{
      text: 'not valid json {{{',
      error: null
    }]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    const result = await engine.generateBriefing({ title: 'Test' });

    assert.ok(result.error);
    assert.strictEqual(result.briefing, null);
  });

  await testAsync('generateBriefing strips markdown code fences', async () => {
    const mock = createMockQueryAI([{
      text: '```json\n{"whoTheyAre":"Bob","whatAbout":"Sync","yourGoals":"Align","talkingPoints":["A"]}\n```',
      error: null
    }]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    const result = await engine.generateBriefing({ title: 'Test' });

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.briefing.whoTheyAre, 'Bob');
  });

  // --- processUserTurn ---

  await testAsync('processUserTurn adds to conversation history and returns response', async () => {
    const mock = createMockQueryAI([
      { text: 'Interesting, tell me more.', error: null }
    ]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    engine.setup({ title: 'Test' });
    engine.startRehearsal('general');

    const result = await engine.processUserTurn('I think we should focus on growth.');

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.response, 'Interesting, tell me more.');
    assert.strictEqual(engine._conversationHistory.length, 2); // user + ai
    assert.strictEqual(engine._fullTranscript.length, 2);
  });

  await testAsync('processUserTurn returns error when not active', async () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });
    // Not started
    const result = await engine.processUserTurn('Hello');
    assert.ok(result.error);
    assert.strictEqual(result.response, null);
  });

  await testAsync('processUserTurn handles AI error gracefully', async () => {
    const mock = createMockQueryAI([
      { text: null, error: 'Network error' }
    ]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    engine.setup({ title: 'Test' });
    engine.startRehearsal('general');

    const result = await engine.processUserTurn('Hello');
    assert.ok(result.error);
    assert.strictEqual(result.response, null);
    // User turn should still be in history
    assert.strictEqual(engine._conversationHistory.length, 1);
  });

  // --- generateOpener ---

  await testAsync('generateOpener returns AI opening and adds to history', async () => {
    const mock = createMockQueryAI([
      { text: 'Hi! Thanks for joining. Tell me about your experience.', error: null }
    ]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    engine.setup({ title: 'Interview' });
    engine.startRehearsal('interview');

    const result = await engine.generateOpener();

    assert.strictEqual(result.error, null);
    assert.ok(result.response.includes('Thanks for joining'));
    assert.strictEqual(engine._conversationHistory.length, 1);
    assert.strictEqual(engine._conversationHistory[0].role, 'ai');
  });

  // --- generateScorecard ---

  await testAsync('generateScorecard returns parsed scores', async () => {
    const mock = createMockQueryAI([
      { text: 'Opening response', error: null }, // opener
      { text: 'Follow up question', error: null }, // processUserTurn
      { text: JSON.stringify({
        clarity: 4, confidence: 3, specificity: 5, pace: 4,
        topReminders: ['Be more specific', 'Slow down'],
        openingFeedback: 'Strong opening with clear intent'
      }), error: null } // scorecard
    ]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    engine.setup({ title: 'Test' });
    engine.startRehearsal('interview');
    await engine.generateOpener();
    await engine.processUserTurn('I have 5 years of experience in PM.');

    const result = await engine.generateScorecard();

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.scorecard.clarity, 4);
    assert.strictEqual(result.scorecard.confidence, 3);
    assert.strictEqual(result.scorecard.specificity, 5);
    assert.strictEqual(result.scorecard.topReminders.length, 2);
    assert.ok(result.scorecard.date);
    assert.strictEqual(result.scorecard.meetingType, 'interview');
    assert.strictEqual(engine._isActive, false); // Should deactivate
  });

  await testAsync('generateScorecard clamps scores to 1-5 range', async () => {
    const mock = createMockQueryAI([{
      text: JSON.stringify({
        clarity: 0, confidence: 7, specificity: -1, pace: 10,
        topReminders: [], openingFeedback: ''
      }),
      error: null
    }]);

    const engine = new RehearsalEngine({ queryAI: mock.fn });
    engine.setup({ title: 'Test' });
    engine.startRehearsal('general');
    // Add fake transcript entries so it doesn't short-circuit to default scorecard
    engine._fullTranscript.push(
      { role: 'ai', text: 'Hello', timestamp: Date.now() },
      { role: 'user', text: 'Hi there', timestamp: Date.now() }
    );

    const result = await engine.generateScorecard();

    assert.strictEqual(result.scorecard.clarity, 1);
    assert.strictEqual(result.scorecard.confidence, 5);
    assert.strictEqual(result.scorecard.specificity, 1);
    assert.strictEqual(result.scorecard.pace, 5);
  });

  await testAsync('generateScorecard returns default for short sessions', async () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });
    engine.setup({ title: 'Test' });
    engine.startRehearsal('general');
    // No conversation — transcript has < 2 entries

    const result = await engine.generateScorecard();

    assert.strictEqual(result.error, null);
    assert.strictEqual(result.scorecard.clarity, 3);
    assert.ok(result.scorecard.topReminders[0].includes('Practice more'));
  });

  // --- generateTransitionCards ---

  test('generateTransitionCards creates cards from scorecard and talking points', () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });

    const scorecard = {
      clarity: 4, confidence: 3, specificity: 5, pace: 4,
      topReminders: ['Be specific', 'Slow down'],
      openingFeedback: 'Good opening'
    };
    const talkingPoints = ['Growth strategy', 'Team structure', 'Timeline'];

    const result = engine.generateTransitionCards(scorecard, talkingPoints);

    assert.ok(result.prepCards.length >= 3);
    assert.ok(result.prepCards.some(c => c.title === 'Remember'));
    assert.ok(result.prepCards.some(c => c.title === 'Talking Points'));
    assert.ok(result.prepCards.some(c => c.title === 'Prep Score'));
    assert.strictEqual(result.checklist.length, 3);
    assert.strictEqual(result.checklist[0].label, 'Growth strategy');
    assert.strictEqual(result.checklist[0].checked, false);
  });

  test('generateTransitionCards handles null scorecard gracefully', () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });
    const result = engine.generateTransitionCards(null, ['Point 1']);

    assert.ok(result.prepCards.length >= 1);
    assert.strictEqual(result.checklist.length, 1);
  });

  test('generateTransitionCards handles empty talking points', () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });
    const scorecard = {
      clarity: 3, confidence: 3, specificity: 3, pace: 3,
      topReminders: ['Remember this'], openingFeedback: 'OK'
    };
    const result = engine.generateTransitionCards(scorecard, []);

    assert.ok(result.prepCards.length >= 2); // Remember + Opening + Score
    assert.strictEqual(result.checklist.length, 0);
  });

  // --- getTranscript ---

  test('getTranscript returns a copy of the transcript', () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });
    engine._fullTranscript = [{ role: 'user', text: 'Hello' }];

    const transcript = engine.getTranscript();
    assert.strictEqual(transcript.length, 1);

    // Modifying the copy shouldn't affect the original
    transcript.push({ role: 'ai', text: 'Hi' });
    assert.strictEqual(engine._fullTranscript.length, 1);
  });

  // --- stop ---

  test('stop deactivates the engine', () => {
    const engine = new RehearsalEngine({ queryAI: async () => ({}) });
    engine.setup({ title: 'Test' });
    engine.startRehearsal('general');
    assert.strictEqual(engine.isActive, true);

    engine.stop();
    assert.strictEqual(engine.isActive, false);
  });

  // --- Summary ---
  console.log(`\n${passCount}/${testCount} tests passed.\n`);
  if (passCount < testCount) process.exit(1);
})();
