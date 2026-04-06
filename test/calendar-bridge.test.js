const assert = require('assert');
const path = require('path');

// CalendarBridge is a CommonJS module
const CalendarBridge = require(path.join(__dirname, '..', 'src', 'shared', 'calendar-bridge'));

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

console.log('\n=== CalendarBridge Tests ===\n');

// --- Constructor ---

test('constructor sets isAvailable based on platform', () => {
  const bridge = new CalendarBridge();
  // On Linux CI, this should be false
  assert.strictEqual(bridge.isAvailable, process.platform === 'darwin');
});

test('constructor initializes empty cache', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge._cache.meetings.length, 0);
  assert.strictEqual(bridge._cache.fetchedAt, 0);
  assert.strictEqual(bridge._cache.windowMinutes, 0);
});

// --- inferMeetingType ---

test('inferMeetingType returns interview for interview titles', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.inferMeetingType('Technical Interview with Alice'), 'interview');
  assert.strictEqual(bridge.inferMeetingType('Screening Call'), 'interview');
  assert.strictEqual(bridge.inferMeetingType('Behavioral Interview Round 2'), 'interview');
});

test('inferMeetingType returns sales-pitch for sales titles', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.inferMeetingType('Product Demo for Acme Corp'), 'sales-pitch');
  assert.strictEqual(bridge.inferMeetingType('Sales Pitch - Q4 Review'), 'sales-pitch');
  assert.strictEqual(bridge.inferMeetingType('Proposal Walkthrough'), 'sales-pitch');
  assert.strictEqual(bridge.inferMeetingType('Prospect Call with Bob'), 'sales-pitch');
});

test('inferMeetingType returns negotiation for negotiation titles', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.inferMeetingType('Contract Negotiation'), 'negotiation');
  assert.strictEqual(bridge.inferMeetingType('Offer Discussion'), 'negotiation');
  assert.strictEqual(bridge.inferMeetingType('Terms Review'), 'negotiation');
});

test('inferMeetingType returns 1-1-networking for 1:1 titles', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.inferMeetingType('1:1 with Manager'), '1-1-networking');
  assert.strictEqual(bridge.inferMeetingType('One on One - Weekly'), '1-1-networking');
  assert.strictEqual(bridge.inferMeetingType('Coffee Chat'), '1-1-networking');
  assert.strictEqual(bridge.inferMeetingType('Weekly Sync'), '1-1-networking');
  assert.strictEqual(bridge.inferMeetingType('Catch up with Alice'), '1-1-networking');
});

test('inferMeetingType returns general for unrecognized titles', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.inferMeetingType('Team Standup'), 'general');
  assert.strictEqual(bridge.inferMeetingType('Sprint Planning'), 'general');
  assert.strictEqual(bridge.inferMeetingType(''), 'general');
});

test('inferMeetingType returns general for null/undefined', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.inferMeetingType(null), 'general');
  assert.strictEqual(bridge.inferMeetingType(undefined), 'general');
});

// --- extractMeetingLink ---

test('extractMeetingLink finds Zoom links', () => {
  const bridge = new CalendarBridge();
  const text = 'Join at https://us02web.zoom.us/j/12345678?pwd=abc123';
  assert.ok(bridge.extractMeetingLink(text).includes('zoom.us'));
});

test('extractMeetingLink finds Google Meet links', () => {
  const bridge = new CalendarBridge();
  const text = 'Meeting link: https://meet.google.com/abc-defg-hij';
  assert.ok(bridge.extractMeetingLink(text).includes('meet.google.com'));
});

test('extractMeetingLink finds Teams links', () => {
  const bridge = new CalendarBridge();
  const text = 'Join: https://teams.microsoft.com/l/meetup-join/abc%2Fdef';
  assert.ok(bridge.extractMeetingLink(text).includes('teams.microsoft.com'));
});

test('extractMeetingLink finds WebEx links', () => {
  const bridge = new CalendarBridge();
  const text = 'https://company.webex.com/meet/john.doe';
  assert.ok(bridge.extractMeetingLink(text).includes('webex.com'));
});

test('extractMeetingLink returns null for no links', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge.extractMeetingLink('No meeting link here'), null);
  assert.strictEqual(bridge.extractMeetingLink(''), null);
  assert.strictEqual(bridge.extractMeetingLink(null), null);
});

// --- _parseUpcomingOutput ---

test('_parseUpcomingOutput parses multiple events', () => {
  const bridge = new CalendarBridge();
  const output = `EVENT_START
ID|||abc-123
TITLE|||Team Standup
START|||2026-04-06T10:00:00
END|||2026-04-06T10:30:00
DESC|||Daily standup meeting
LOCATION|||https://meet.google.com/abc-def
ATTENDEES|||Alice, Bob
EVENT_END
EVENT_START
ID|||def-456
TITLE|||1:1 with Manager
START|||2026-04-06T14:00:00
END|||2026-04-06T14:30:00
DESC|||Weekly check-in
LOCATION|||Room 3B
ATTENDEES|||Manager
EVENT_END`;

  const meetings = bridge._parseUpcomingOutput(output);
  assert.strictEqual(meetings.length, 2);
  assert.strictEqual(meetings[0].id, 'abc-123');
  assert.strictEqual(meetings[0].title, 'Team Standup');
  assert.strictEqual(meetings[0].startDate, '2026-04-06T10:00:00');
  assert.strictEqual(meetings[0].attendees, 'Alice, Bob');
  assert.ok(meetings[0].meetingLink.includes('meet.google.com'));
  assert.strictEqual(meetings[0].inferredType, 'general');
  assert.strictEqual(meetings[1].inferredType, '1-1-networking');
});

test('_parseUpcomingOutput returns empty array for empty output', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge._parseUpcomingOutput('').length, 0);
  assert.strictEqual(bridge._parseUpcomingOutput(null).length, 0);
});

test('_parseUpcomingOutput handles events with no description', () => {
  const bridge = new CalendarBridge();
  const output = `EVENT_START
ID|||xyz-789
TITLE|||Quick Call
START|||2026-04-06T16:00:00
END|||2026-04-06T16:15:00
DESC|||
LOCATION|||
ATTENDEES|||
EVENT_END`;

  const meetings = bridge._parseUpcomingOutput(output);
  assert.strictEqual(meetings.length, 1);
  assert.strictEqual(meetings[0].title, 'Quick Call');
  assert.strictEqual(meetings[0].description, '');
  assert.strictEqual(meetings[0].meetingLink, null);
});

test('_parseUpcomingOutput preserves colons in timestamps', () => {
  const bridge = new CalendarBridge();
  const output = `EVENT_START
ID|||test-1
TITLE|||Meeting
START|||2026-04-06T19:30:00
END|||2026-04-06T20:00:00
DESC|||
LOCATION|||
ATTENDEES|||
EVENT_END`;

  const meetings = bridge._parseUpcomingOutput(output);
  assert.strictEqual(meetings[0].startDate, '2026-04-06T19:30:00');
  assert.strictEqual(meetings[0].endDate, '2026-04-06T20:00:00');
});

// --- _parseDetailOutput ---

test('_parseDetailOutput parses meeting details', () => {
  const bridge = new CalendarBridge();
  const output = `TITLE|||Interview with Nan Yu
START|||2026-04-06T15:00:00
END|||2026-04-06T15:45:00
DESC|||Technical interview for Senior PM role
LOCATION|||https://us02web.zoom.us/j/12345
ATTENDEES|||Nan Yu, Amelia`;

  const context = bridge._parseDetailOutput(output);
  assert.strictEqual(context.title, 'Interview with Nan Yu');
  assert.strictEqual(context.startDate, '2026-04-06T15:00:00');
  assert.strictEqual(context.attendees, 'Nan Yu, Amelia');
  assert.ok(context.meetingLink.includes('zoom.us'));
  assert.strictEqual(context.inferredType, 'interview');
});

test('_parseDetailOutput returns null for empty output', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge._parseDetailOutput(''), null);
  assert.strictEqual(bridge._parseDetailOutput(null), null);
});

test('_parseDetailOutput returns null for output with no title', () => {
  const bridge = new CalendarBridge();
  assert.strictEqual(bridge._parseDetailOutput('DESC|||some description'), null);
});

// --- _parseEventBlock ---

test('_parseEventBlock skips events with no title', () => {
  const bridge = new CalendarBridge();
  const block = `ID|||abc
DESC|||some description
EVENT_END`;
  assert.strictEqual(bridge._parseEventBlock(block), null);
});

// --- getUpcomingMeetings on non-macOS ---

(async () => {
  await testAsync('getUpcomingMeetings returns empty on non-macOS', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = false;
    const result = await bridge.getUpcomingMeetings();
    assert.strictEqual(result.meetings.length, 0);
    assert.strictEqual(result.error, null);
  });

  await testAsync('getMeetingContext returns error on non-macOS', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = false;
    const result = await bridge.getMeetingContext('test-id');
    assert.strictEqual(result.context, null);
    assert.ok(result.error);
  });

  await testAsync('getNextMeeting returns null on non-macOS', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = false;
    const result = await bridge.getNextMeeting();
    assert.strictEqual(result.meeting, null);
    assert.strictEqual(result.minutesUntil, null);
    assert.strictEqual(result.error, null);
  });

  // --- Cache ---

  await testAsync('getUpcomingMeetings uses cache within TTL', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = true; // Pretend macOS to test cache path

    let osascriptCallCount = 0;
    const futureDate = new Date(Date.now() + 10 * 60000).toISOString();
    bridge._runOsascript = async () => {
      osascriptCallCount++;
      return `EVENT_START\nID|||test-1\nTITLE|||Cached Meeting\nSTART|||${futureDate}\nEND|||${futureDate}\nDESC|||\nLOCATION|||\nATTENDEES|||\nEVENT_END`;
    };

    // First call should invoke osascript
    const result1 = await bridge.getUpcomingMeetings(60);
    assert.strictEqual(osascriptCallCount, 1);
    assert.strictEqual(result1.meetings.length, 1);

    // Second call within TTL should use cache (no additional osascript call)
    const result2 = await bridge.getUpcomingMeetings(60);
    assert.strictEqual(osascriptCallCount, 1); // Still 1 — cache hit
    assert.strictEqual(result2.meetings.length, 1);
  });

  await testAsync('cache is invalidated when requested window exceeds cached window', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = true;

    const meeting15min = new Date(Date.now() + 10 * 60000).toISOString();
    const meeting70min = new Date(Date.now() + 70 * 60000).toISOString();
    let callCount = 0;

    bridge._runOsascript = async (script) => {
      callCount++;
      // First call (60-min window) returns only the 15-min meeting
      if (callCount === 1) {
        return `EVENT_START\nID|||m1\nTITLE|||Soon\nSTART|||${meeting15min}\nEND|||${meeting15min}\nDESC|||\nLOCATION|||\nATTENDEES|||\nEVENT_END`;
      }
      // Second call (90-min window) returns both meetings
      return `EVENT_START\nID|||m1\nTITLE|||Soon\nSTART|||${meeting15min}\nEND|||${meeting15min}\nDESC|||\nLOCATION|||\nATTENDEES|||\nEVENT_END\nEVENT_START\nID|||m2\nTITLE|||Later\nSTART|||${meeting70min}\nEND|||${meeting70min}\nDESC|||\nLOCATION|||\nATTENDEES|||\nEVENT_END`;
    };

    // First call: 60-min window (fetches 60 min of data)
    const r1 = await bridge.getUpcomingMeetings(60);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(r1.meetings.length, 1);

    // Second call: 90-min window — should NOT use cache (window too small)
    const r2 = await bridge.getUpcomingMeetings(90);
    assert.strictEqual(callCount, 2); // Must re-fetch
    assert.strictEqual(r2.meetings.length, 2); // Both meetings returned
  });

  // --- clearCache ---

  test('clearCache resets cache', () => {
    const bridge = new CalendarBridge();
    bridge._cache = { meetings: [{ id: '1' }], fetchedAt: Date.now(), windowMinutes: 90 };
    bridge.clearCache();
    assert.strictEqual(bridge._cache.meetings.length, 0);
    assert.strictEqual(bridge._cache.fetchedAt, 0);
    assert.strictEqual(bridge._cache.windowMinutes, 0);
  });

  // --- getNextMeeting sort safety ---

  await testAsync('getNextMeeting does not mutate the source array', async () => {
    const bridge = new CalendarBridge();
    // Mock getUpcomingMeetings to return a known array
    const meetings = [
      { id: '2', title: 'Later', startDate: new Date(Date.now() + 10 * 60000).toISOString() },
      { id: '1', title: 'Sooner', startDate: new Date(Date.now() + 5 * 60000).toISOString() }
    ];
    bridge.getUpcomingMeetings = async () => ({ meetings, error: null });

    const result = await bridge.getNextMeeting(15);
    assert.strictEqual(result.meeting.id, '1'); // Sooner
    // Original array should not be mutated
    assert.strictEqual(meetings[0].id, '2'); // Still in original order
  });

  // --- withinMinutes coercion ---

  await testAsync('getUpcomingMeetings coerces withinMinutes=0 to 60', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = true;
    const now = Date.now();
    let capturedWindow = null;
    bridge._runOsascript = async (script) => {
      const match = script.match(/set endTime to now \+ (\d+) \* minutes/);
      capturedWindow = match ? parseInt(match[1]) : null;
      return '';
    };
    await bridge.getUpcomingMeetings(0);
    assert.strictEqual(capturedWindow, 60, 'withinMinutes=0 should be coerced to 60 via parseInt(0)||60');
  });

  // --- Cache serves narrower window from larger cached window ---

  await testAsync('cache hit: 90-min cache serves a 60-min request without re-fetching', async () => {
    const bridge = new CalendarBridge();
    bridge._isMacOS = true;
    const now = Date.now();
    let callCount = 0;
    const t10 = new Date(now + 10 * 60000).toISOString();
    const t70 = new Date(now + 70 * 60000).toISOString();

    bridge._runOsascript = async () => {
      callCount++;
      return [
        `EVENT_START\nID|||m10\nTITLE|||10-Min\nSTART|||${t10}\nEND|||${t10}\nDESC|||\nLOCATION|||\nATTENDEES|||\nEVENT_END`,
        `EVENT_START\nID|||m70\nTITLE|||70-Min\nSTART|||${t70}\nEND|||${t70}\nDESC|||\nLOCATION|||\nATTENDEES|||\nEVENT_END`
      ].join('\n');
    };

    // First call: 90-min window — fetches and caches 90 min of data
    const r1 = await bridge.getUpcomingMeetings(90);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(r1.meetings.length, 2);

    // Second call: 60-min window — cache covers it (windowMinutes=90 >= 60), no re-fetch
    const r2 = await bridge.getUpcomingMeetings(60);
    assert.strictEqual(callCount, 1, 'Should be cache hit — no re-fetch needed');
    assert.strictEqual(r2.meetings.length, 1, '_filterByWindow(60) applied to cached 90-min data');
    assert.strictEqual(r2.meetings[0].id, 'm10', 'Only the 10-min meeting is within 60-min window');
  });

  // --- Summary ---
  console.log(`\n${passCount}/${testCount} tests passed.\n`);
  if (passCount < testCount) process.exit(1);
})();
