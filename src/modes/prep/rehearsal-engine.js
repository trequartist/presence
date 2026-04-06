/**
 * RehearsalEngine — AI conversation + scoring for Pre-Meeting Prep.
 * Runs in renderer process. All AI calls go through window.presence.queryAI().
 * 
 * Usage:
 *   const engine = new RehearsalEngine();
 *   const briefing = await engine.generateBriefing(context);
 *   engine.startRehearsal(meetingType);
 *   const aiResponse = await engine.processUserTurn(transcript);
 *   const scorecard = await engine.generateScorecard();
 *   const cards = engine.generateTransitionCards(scorecard, talkingPoints);
 */

class RehearsalEngine {
  /**
   * @param {object} opts
   * @param {function} opts.queryAI - AI query function. Defaults to window.presence.queryAI.
   *   Signature: (prompt, opts) => Promise<{text: string|null, error: string|null}>
   */
  constructor(opts = {}) {
    this._queryAI = opts.queryAI || (typeof window !== 'undefined' && window.presence ? window.presence.queryAI : null);
    this._context = null;
    this._meetingType = 'general';
    this._conversationHistory = [];
    this._fullTranscript = [];
    this._systemPrompt = '';
    this._isActive = false;
  }

  /**
   * Initialize with meeting context.
   */
  setup(context) {
    this._context = context;
    this._conversationHistory = [];
    this._fullTranscript = [];
    this._isActive = false;
  }

  /**
   * Check if AI is available.
   */
  _checkAI() {
    if (!this._queryAI) {
      return { error: 'AI not available. Ensure window.presence is loaded.' };
    }
    return null;
  }

  /**
   * Generate a briefing from meeting context.
   * @param {object} context - { title, attendees, description, goals, meetingType }
   * @returns {Promise<{briefing: object|null, error: string|null}>}
   */
  async generateBriefing(context) {
    const aiCheck = this._checkAI();
    if (aiCheck) return { briefing: null, ...aiCheck };
    const prompt = `You are preparing someone for an upcoming meeting. Generate a concise briefing.

Meeting Details:
- Title: ${context.title || 'Untitled meeting'}
- Attendees: ${context.attendees || 'Not specified'}
- Description: ${context.description || 'No description'}
- Your Goals: ${context.goals || 'Not specified'}
- Meeting Type: ${context.meetingType || 'general'}

Respond with ONLY valid JSON:
{
  "whoTheyAre": "Brief on the other person/people based on available info",
  "whatAbout": "What this meeting is about in 1-2 sentences",
  "yourGoals": "Reframed version of the user's goals, made more actionable",
  "talkingPoints": [
    "First suggested talking point",
    "Second suggested talking point",
    "Third suggested talking point"
  ]
}`;

    const result = await this._queryAI(prompt, {
      temperature: 0.6,
      maxTokens: 1024,
      systemPrompt: 'You are a meeting preparation coach. Respond with valid JSON only, no markdown.'
    });

    if (result.error) {
      return { briefing: null, error: result.error };
    }

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return { briefing: JSON.parse(cleaned), error: null };
    } catch (err) {
      return { briefing: null, error: 'Failed to parse briefing response' };
    }
  }

  /**
   * Start a rehearsal session.
   * @param {string} meetingType - interview | sales-pitch | negotiation | 1-1-networking | custom
   */
  startRehearsal(meetingType) {
    this._meetingType = meetingType || 'general';
    this._conversationHistory = [];
    this._fullTranscript = [];
    this._isActive = true;

    this._systemPrompt = this._buildSystemPrompt(meetingType);
  }

  _buildSystemPrompt(meetingType) {
    const ctx = this._context || {};
    const base = `You are role-playing as the other person in a meeting rehearsal. The meeting is: "${ctx.title || 'a meeting'}". Attendees: ${ctx.attendees || 'unknown'}. Description: ${ctx.description || 'none'}.

Keep responses SHORT (2-4 sentences max). Be natural and conversational. Push the user to be specific and concrete.`;

    const typePrompts = {
      'interview': `${base}

You are the interviewer. Ask behavioral questions. Probe for STAR format (Situation, Task, Action, Result). If answers are vague, push for specifics. Ask follow-up questions that dig deeper.`,

      'sales-pitch': `${base}

You are a skeptical potential customer/investor. Raise objections. Ask for specifics and data. Challenge assumptions. Ask "why should I care?" and "what makes this different?"`,

      'negotiation': `${base}

You are the counterparty in a negotiation. Push back on anchors. Test their framing. Ask for justification. Propose alternatives. Be firm but fair.`,

      '1-1-networking': `${base}

You are a professional peer having a 1:1 conversation. Be conversational and relationship-building. Ask about their work, interests, and goals. Share relevant context. Be warm but substantive.`,

      'custom': `${base}

Custom scenario: ${ctx.customScenario || 'No specific scenario provided.'}

Follow the scenario described above. Respond naturally and push the user to articulate their points clearly.`,

      'general': `${base}

Respond naturally. Ask clarifying questions. Push for specifics when answers are vague.`
    };

    return typePrompts[meetingType] || typePrompts['general'];
  }

  /**
   * Process a user's spoken turn and generate an AI response.
   * @param {string} transcript - The user's speech transcript
   * @returns {Promise<{response: string|null, error: string|null}>}
   */
  async processUserTurn(transcript) {
    if (!this._isActive) {
      return { response: null, error: 'Rehearsal not active' };
    }
    const aiCheck = this._checkAI();
    if (aiCheck) return { response: null, ...aiCheck };

    this._conversationHistory.push({ role: 'user', text: transcript });
    this._fullTranscript.push({ role: 'user', text: transcript, timestamp: Date.now() });

    // Build conversation context for AI
    const recentHistory = this._conversationHistory.slice(-6); // Last 3 exchanges
    let conversationText = recentHistory
      .map(turn => `${turn.role === 'user' ? 'Them' : 'You'}: ${turn.text}`)
      .join('\n');

    const prompt = `Continue this conversation. You are role-playing. Respond to what they just said.

Conversation so far:
${conversationText}

Remember: Keep your response SHORT (2-4 sentences). Be natural. Push for specifics.`;

    const result = await this._queryAI(prompt, {
      temperature: 0.8,
      maxTokens: 256,
      systemPrompt: this._systemPrompt
    });

    if (result.error) {
      return { response: null, error: result.error };
    }

    const response = result.text.trim();
    this._conversationHistory.push({ role: 'ai', text: response });
    this._fullTranscript.push({ role: 'ai', text: response, timestamp: Date.now() });

    return { response, error: null };
  }

  /**
   * Generate the opening AI message to kick off the rehearsal.
   * @returns {Promise<{response: string|null, error: string|null}>}
   */
  async generateOpener() {
    const aiCheck = this._checkAI();
    if (aiCheck) return { response: null, ...aiCheck };
    const ctx = this._context || {};
    const prompt = `Start this meeting rehearsal with a brief opening line. You are the other person in the meeting.

Meeting: ${ctx.title || 'a meeting'}
Type: ${this._meetingType}
${ctx.description ? 'Context: ' + ctx.description : ''}

Give a natural 1-2 sentence opening that sets the scene. For interviews, start with a greeting and first question. For sales, start with "tell me about..." For networking, start with a warm greeting.`;

    const result = await this._queryAI(prompt, {
      temperature: 0.8,
      maxTokens: 128,
      systemPrompt: this._systemPrompt
    });

    if (result.error) {
      return { response: null, error: result.error };
    }

    const response = result.text.trim();
    this._conversationHistory.push({ role: 'ai', text: response });
    this._fullTranscript.push({ role: 'ai', text: response, timestamp: Date.now() });

    return { response, error: null };
  }

  /**
   * Generate a scorecard from the rehearsal transcript.
   * @returns {Promise<{scorecard: object|null, error: string|null}>}
   */
  async generateScorecard() {
    this._isActive = false;

    if (this._fullTranscript.length < 2) {
      return {
        scorecard: {
          clarity: 3, confidence: 3, specificity: 3, pace: 3,
          topReminders: ['Practice more to get detailed feedback', 'Try speaking for at least 2 exchanges'],
          openingFeedback: 'Session was too short for detailed analysis.',
          date: new Date().toISOString(),
          meetingType: this._meetingType,
          exchangeCount: this._fullTranscript.length
        },
        error: null
      };
    }

    // Truncate to last 20 turns to avoid hitting token limits on long rehearsals
    const recentTranscript = this._fullTranscript.slice(-20);

    const userTurns = recentTranscript
      .filter(t => t.role === 'user')
      .map(t => t.text)
      .join('\n\n');

    const fullConvo = recentTranscript
      .map(t => `${t.role === 'user' ? 'USER' : 'AI'}: ${t.text}`)
      .join('\n');

    const prompt = `Score this meeting rehearsal. The user was practicing for a ${this._meetingType} meeting.

Full conversation:
${fullConvo}

User's statements only:
${userTurns}

Score each metric 1-5 and provide feedback. Respond with ONLY valid JSON:
{
  "clarity": <1-5>,
  "confidence": <1-5>,
  "specificity": <1-5>,
  "pace": <1-5>,
  "topReminders": ["First thing to remember", "Second thing to remember"],
  "openingFeedback": "One sentence about how their opening was"
}

Scoring guide:
- clarity: Were points crisp and specific? (5=crystal clear, 1=rambling/unclear)
- confidence: Did they sound certain? Detect hedging words like "maybe", "I think", "sort of" (5=very confident, 1=lots of hedging)
- specificity: Did they use concrete examples, numbers, names? (5=very specific, 1=all abstract)
- pace: Based on response length and structure, was the pacing good? (5=well-paced, 1=too rushed or too slow)`;

    const result = await this._queryAI(prompt, {
      temperature: 0.3,
      maxTokens: 512,
      systemPrompt: 'You are a communication coach scoring a practice session. Be honest and constructive. Respond with valid JSON only.'
    });

    if (result.error) {
      return { scorecard: null, error: result.error };
    }

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const scorecard = {
        clarity: Math.min(5, Math.max(1, typeof parsed.clarity === 'number' ? parsed.clarity : 3)),
        confidence: Math.min(5, Math.max(1, typeof parsed.confidence === 'number' ? parsed.confidence : 3)),
        specificity: Math.min(5, Math.max(1, typeof parsed.specificity === 'number' ? parsed.specificity : 3)),
        pace: Math.min(5, Math.max(1, typeof parsed.pace === 'number' ? parsed.pace : 3)),
        topReminders: Array.isArray(parsed.topReminders) ? parsed.topReminders.slice(0, 2) : [],
        openingFeedback: parsed.openingFeedback || '',
        date: new Date().toISOString(),
        meetingType: this._meetingType,
        exchangeCount: this._fullTranscript.length
      };

      return { scorecard, error: null };
    } catch (err) {
      return { scorecard: null, error: 'Failed to parse scorecard response' };
    }
  }

  /**
   * Generate cue cards for coach mode transition.
   * @param {object} scorecard - The generated scorecard
   * @param {string[]} talkingPoints - Talking points from the briefing
   * @returns {{prepCards: Array, checklist: Array}}
   */
  generateTransitionCards(scorecard, talkingPoints) {
    const prepCards = [];

    // Card from scorecard reminders
    if (scorecard && scorecard.topReminders && scorecard.topReminders.length > 0) {
      prepCards.push({
        title: 'Remember',
        body: scorecard.topReminders.join('\n')
      });
    }

    // Card from opening feedback
    if (scorecard && scorecard.openingFeedback) {
      prepCards.push({
        title: 'Opening',
        body: scorecard.openingFeedback
      });
    }

    // Cards from talking points
    if (talkingPoints && talkingPoints.length > 0) {
      prepCards.push({
        title: 'Talking Points',
        body: talkingPoints.join('\n')
      });
    }

    // Score summary card
    if (scorecard) {
      prepCards.push({
        title: 'Prep Score',
        body: `Clarity: ${scorecard.clarity}/5\nConfidence: ${scorecard.confidence}/5\nSpecificity: ${scorecard.specificity}/5\nPace: ${scorecard.pace}/5`
      });
    }

    // Checklist from talking points
    const checklist = (talkingPoints || []).map(tp => ({
      label: tp,
      checked: false
    }));

    return { prepCards, checklist };
  }

  /**
   * Get the full transcript for reference.
   */
  getTranscript() {
    return [...this._fullTranscript];
  }

  /**
   * Check if rehearsal is currently active.
   */
  get isActive() {
    return this._isActive;
  }

  /**
   * Stop the rehearsal without generating a scorecard.
   */
  stop() {
    this._isActive = false;
  }
}
