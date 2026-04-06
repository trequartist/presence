/**
 * AI Client — Gemini 2.5 Flash wrapper.
 * Runs in main process only. API key from process.env, NEVER sent to renderer.
 */

const GEMINI_MODEL = 'gemini-2.5-flash-preview-04-17';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

class AIClient {
  constructor() {
    this._apiKey = null;
  }

  /**
   * Initialize with API key from environment.
   * Call once at app startup.
   */
  init() {
    this._apiKey = process.env.GEMINI_API_KEY || '';
    if (!this._apiKey) {
      console.warn('[AIClient] GEMINI_API_KEY not set. AI features will be unavailable.');
    }
  }

  get isAvailable() {
    return !!this._apiKey;
  }

  /**
   * Send a prompt to Gemini and return a result object.
   * @param {string} prompt - The user prompt
   * @param {object} opts - { maxTokens, temperature, systemPrompt }
   * @returns {Promise<{text: string|null, error: string|null}>}
   */
  async queryGemini(prompt, opts = {}) {
    if (!this._apiKey) {
      return { text: null, error: 'Gemini API key not configured. Set GEMINI_API_KEY in your .env file.' };
    }

    const { maxTokens = 2048, temperature = 0.7, systemPrompt = '' } = opts;

    const contents = [];
    if (systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${this._apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature
          }
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error('[AIClient] Gemini API error:', response.status, errBody);
        return { text: null, error: `Gemini API error (${response.status})` };
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { text, error: null };
    } catch (err) {
      console.error('[AIClient] Network error:', err.message);
      return { text: null, error: `Network error: ${err.message}` };
    }
  }

  /**
   * Generate prep cards and checklist from context.
   * @param {string} context - Meeting/prep context text
   * @returns {Promise<{cards: Array, checklist: Array, error: string|null}>}
   */
  async generateCards(context) {
    const prompt = `Based on this meeting context, generate preparation cards and a checklist.

Context:
${context}

Respond with ONLY valid JSON in this exact format:
{
  "cards": [
    {"title": "Card Title", "body": "Card content with key points"}
  ],
  "checklist": [
    {"label": "Topic to cover", "checked": false}
  ]
}

Generate 3-6 cards covering key talking points, and 4-7 checklist items for topics to cover.`;

    const result = await this.queryGemini(prompt, {
      maxTokens: 2048,
      temperature: 0.5,
      systemPrompt: 'You are a meeting preparation assistant. Always respond with valid JSON only, no markdown formatting.'
    });

    if (result.error) {
      return { cards: [], checklist: [], error: result.error };
    }

    try {
      // Strip markdown code fences if present
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return { cards: parsed.cards || [], checklist: parsed.checklist || [], error: null };
    } catch (err) {
      console.error('[AIClient] Failed to parse card generation response:', err.message);
      return { cards: [], checklist: [], error: 'Failed to parse AI response' };
    }
  }
}

module.exports = new AIClient();
