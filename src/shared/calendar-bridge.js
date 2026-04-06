/**
 * calendar-bridge.js — macOS Calendar.app integration via osascript.
 * Queries upcoming events, parses attendees/descriptions, and provides
 * meeting context for the Pre-Meeting Prep mode.
 *
 * Gracefully degrades on non-macOS platforms (returns empty arrays).
 */

const { execFile } = require('child_process');
const os = require('os');

class CalendarBridge {
  constructor() {
    this._isMacOS = os.platform() === 'darwin';
    this._cache = { meetings: [], fetchedAt: 0, windowMinutes: 0 };
    this._cacheTTLMs = 30000; // 30 seconds
  }

  /**
   * Check if calendar integration is available.
   */
  get isAvailable() {
    return this._isMacOS;
  }

  /**
   * Get upcoming meetings within the specified time window.
   * @param {number} withinMinutes - Look-ahead window (default: 60)
   * @returns {Promise<{meetings: Array, error: string|null}>}
   */
  async getUpcomingMeetings(withinMinutes = 60) {
    withinMinutes = parseInt(withinMinutes, 10) || 60;

    if (!this._isMacOS) {
      return { meetings: [], error: null };
    }

    // Note: osascript dates are in local timezone (no offset). new Date() parses
    // them as local time, which matches macOS Calendar behavior. If TZ env differs
    // from macOS system timezone, comparisons may be off.
    const now = Date.now();

    // Return cached results if fresh AND the cache covers the requested window
    if (this._cache.fetchedAt > 0
        && now - this._cache.fetchedAt < this._cacheTTLMs
        && this._cache.windowMinutes >= withinMinutes) {
      return { meetings: this._filterByWindow(this._cache.meetings, withinMinutes, now), error: null };
    }

    try {
      // Always fetch a 60-min window to maximize cache hits
      const fetchWindow = Math.max(withinMinutes, 60);
      const script = this._buildUpcomingScript(fetchWindow);
      const output = await this._runOsascript(script);
      const allMeetings = this._parseUpcomingOutput(output);

      this._cache = { meetings: allMeetings, fetchedAt: now, windowMinutes: fetchWindow };

      return { meetings: this._filterByWindow(allMeetings, withinMinutes, now), error: null };
    } catch (err) {
      return { meetings: [], error: err.message || 'Failed to query calendar' };
    }
  }

  /**
   * Get detailed context for a specific meeting by its ID.
   * @param {string} eventId - The event identifier
   * @returns {Promise<{context: object|null, error: string|null}>}
   */
  async getMeetingContext(eventId) {
    if (!this._isMacOS) {
      return { context: null, error: 'Calendar not available on this platform' };
    }

    try {
      const script = this._buildDetailScript(eventId);
      const output = await this._runOsascript(script);
      const context = this._parseDetailOutput(output);
      return { context, error: null };
    } catch (err) {
      return { context: null, error: err.message || 'Failed to get meeting details' };
    }
  }

  /**
   * Find the next meeting starting within the given minutes.
   * @param {number} withinMinutes
   * @returns {Promise<{meeting: object|null, minutesUntil: number|null, error: string|null}>}
   */
  async getNextMeeting(withinMinutes = 15) {
    const result = await this.getUpcomingMeetings(withinMinutes);
    if (result.error) return { meeting: null, minutesUntil: null, error: result.error };
    if (result.meetings.length === 0) return { meeting: null, minutesUntil: null, error: null };

    // Sort by start time, pick earliest (copy to avoid mutating cache)
    const sorted = [...result.meetings].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    const next = sorted[0];
    const minutesUntil = Math.round(
      (new Date(next.startDate).getTime() - Date.now()) / 60000
    );

    return { meeting: next, minutesUntil, error: null };
  }

  /**
   * Parse a meeting title to infer meeting type.
   * @param {string} title
   * @returns {string} - interview | sales-pitch | negotiation | 1-1-networking | general
   */
  inferMeetingType(title) {
    if (!title) return 'general';
    const lower = title.toLowerCase();

    if (/interview|screening|behavioral|technical screen/.test(lower)) return 'interview';
    if (/demo|pitch|sales|proposal|prospect/.test(lower)) return 'sales-pitch';
    if (/negotiat|contract|terms|offer/.test(lower)) return 'negotiation';
    if (/1[:\-]1|one.on.one|catch.?up|coffee|sync/.test(lower)) return '1-1-networking';

    return 'general';
  }

  /**
   * Extract meeting link (Zoom, Google Meet, Teams) from text.
   * @param {string} text - Description or notes
   * @returns {string|null}
   */
  extractMeetingLink(text) {
    if (!text) return null;

    const patterns = [
      /https?:\/\/[\w.-]*zoom\.us\/j\/[\w?=&-]+/i,
      /https?:\/\/meet\.google\.com\/[\w-]+/i,
      /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[\w%.-]+/i,
      /https?:\/\/[\w.-]*webex\.com\/[\w/.?=&-]+/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }

    return null;
  }

  /**
   * Filter meetings to those starting within the given window.
   */
  _filterByWindow(meetings, withinMinutes, now) {
    now = now || Date.now();
    return meetings.filter(m => {
      const startTime = new Date(m.startDate).getTime();
      return startTime > now && startTime < now + withinMinutes * 60000;
    });
  }

  // =============================================
  // AppleScript builders
  // =============================================

  _buildUpcomingScript(withinMinutes) {
    // AppleScript to get upcoming events from Calendar.app
    // Only query if Calendar.app is already running (don't launch it)
    return `
      if application "Calendar" is not running then return ""

      set now to current date
      set endTime to now + ${withinMinutes} * minutes
      set output to ""

      tell application "Calendar"
        repeat with cal in calendars
          set eventList to (every event of cal whose start date >= now and start date <= endTime)
          repeat with evt in eventList
            set evtId to uid of evt
            set evtTitle to summary of evt
            set evtStart to start date of evt
            set evtEnd to end date of evt
            set evtDesc to ""
            try
              set evtDesc to description of evt
            end try
            set evtLocation to ""
            try
              set evtLocation to location of evt
            end try

            -- Get attendee names
            set attendeeNames to ""
            try
              set attendeeList to attendees of evt
              repeat with att in attendeeList
                if attendeeNames is not "" then
                  set attendeeNames to attendeeNames & ", "
                end if
                set attendeeNames to attendeeNames & (display name of att)
              end repeat
            end try

            set output to output & "EVENT_START" & return
            set output to output & "ID|||" & evtId & return
            set output to output & "TITLE|||" & evtTitle & return
            set output to output & "START|||" & (evtStart as «class isot» as string) & return
            set output to output & "END|||" & (evtEnd as «class isot» as string) & return
            set output to output & "DESC|||" & evtDesc & return
            set output to output & "LOCATION|||" & evtLocation & return
            set output to output & "ATTENDEES|||" & attendeeNames & return
            set output to output & "EVENT_END" & return
          end repeat
        end repeat
      end tell

      return output
    `;
  }

  _buildDetailScript(eventId) {
    return `
      if application "Calendar" is not running then return ""

      set output to ""
      tell application "Calendar"
        repeat with cal in calendars
          try
            set evt to (first event of cal whose uid is "${eventId.replace(/[^a-zA-Z0-9\-_:.@]/g, '')}")
            set evtTitle to summary of evt
            set evtStart to start date of evt
            set evtEnd to end date of evt
            set evtDesc to ""
            try
              set evtDesc to description of evt
            end try
            set evtLocation to ""
            try
              set evtLocation to location of evt
            end try
            set attendeeNames to ""
            try
              set attendeeList to attendees of evt
              repeat with att in attendeeList
                if attendeeNames is not "" then
                  set attendeeNames to attendeeNames & ", "
                end if
                set attendeeNames to attendeeNames & (display name of att)
              end repeat
            end try

            set output to "TITLE|||" & evtTitle & return
            set output to output & "START|||" & (evtStart as «class isot» as string) & return
            set output to output & "END|||" & (evtEnd as «class isot» as string) & return
            set output to output & "DESC|||" & evtDesc & return
            set output to output & "LOCATION|||" & evtLocation & return
            set output to output & "ATTENDEES|||" & attendeeNames & return

            return output
          end try
        end repeat
      end tell

      return output
    `;
  }

  // =============================================
  // Output parsers
  // =============================================

  _parseUpcomingOutput(output) {
    if (!output || !output.trim()) return [];

    const meetings = [];
    const blocks = output.split('EVENT_START').filter(b => b.includes('EVENT_END'));

    for (const block of blocks) {
      const meeting = this._parseEventBlock(block);
      if (meeting && meeting.title) {
        meetings.push(meeting);
      }
    }

    return meetings;
  }

  _parseEventBlock(block) {
    const lines = block.split('\n');
    const data = {};

    for (const line of lines) {
      const delimIdx = line.indexOf('|||');
      if (delimIdx === -1) continue;
      const key = line.slice(0, delimIdx).trim();
      const value = line.slice(delimIdx + 3).trim();

      switch (key) {
        case 'ID': data.id = value; break;
        case 'TITLE': data.title = value; break;
        case 'START': data.startDate = value; break;
        case 'END': data.endDate = value; break;
        case 'DESC': data.description = value; break;
        case 'LOCATION': data.location = value; break;
        case 'ATTENDEES': data.attendees = value; break;
      }
    }

    if (!data.title) return null;

    return {
      id: data.id || '',
      title: data.title,
      startDate: data.startDate || '',
      endDate: data.endDate || '',
      description: data.description || '',
      location: data.location || '',
      attendees: data.attendees || '',
      meetingLink: this.extractMeetingLink(
        (data.description || '') + ' ' + (data.location || '')
      ),
      inferredType: this.inferMeetingType(data.title)
    };
  }

  _parseDetailOutput(output) {
    if (!output || !output.trim()) return null;
    const result = this._parseEventBlock(output);
    if (!result) return null;
    // Detail output has no ID field — strip it
    const { id, ...context } = result;
    return context;
  }

  // =============================================
  // osascript runner
  // =============================================

  _runOsascript(script) {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], {
        timeout: 10000,
        maxBuffer: 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err) {
          // Calendar.app not running or permission denied
          if (err.code === 'ENOENT') {
            reject(new Error('osascript not found — not running on macOS'));
          } else if (stderr && stderr.includes('not allowed')) {
            reject(new Error('Calendar access denied. Grant permission in System Preferences > Privacy > Automation.'));
          } else {
            reject(new Error(`Calendar query failed: ${err.message}`));
          }
          return;
        }
        resolve(stdout || '');
      });
    });
  }

  /**
   * Clear the meeting cache (useful after state changes).
   */
  clearCache() {
    this._cache = { meetings: [], fetchedAt: 0, windowMinutes: 0 };
  }
}

module.exports = CalendarBridge;
