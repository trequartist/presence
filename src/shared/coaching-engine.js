// coaching-engine.js — Rule-based coaching with priority system
// Pure logic, no DOM or audio dependencies.

class CoachingEngine {
  constructor(options = {}) {
    this.monologueWarnSec = options.monologueWarnSec || 60;
    this.encourageIntervalMin = options.encourageIntervalMin || 4;

    this.currentMessage = null;
    this.currentPriority = 99;
    this.messageSetAt = 0;
    this.lastEncouragementAt = 0;
    this.encourageIndex = 0;
    this.monologueWarnings = 0;

    this.encouragements = [
      'You got this, champ',
      'Stay curious',
      "Be yourself \u2014 that's your superpower",
      "Listen for what they're NOT saying",
      'Great energy \u2014 keep it up',
      'Remember: connection > perfection',
      'Breathe. You belong here.',
      "They're rooting for you too"
    ];
  }

  update(metrics) {
    const now = performance.now();
    const candidates = [];

    // === Monologue checks (highest priority) ===
    if (metrics.continuousSpeechSec > 120) {
      candidates.push({
        message: "You've been talking for 2 min straight",
        zone: 'monologue', color: '#ff4444', priority: 1
      });
    } else if (metrics.continuousSpeechSec > 90) {
      candidates.push({
        message: 'Stop and check in',
        zone: 'monologue', color: '#ff6b35', priority: 2
      });
    } else if (metrics.continuousSpeechSec > this.monologueWarnSec) {
      candidates.push({
        message: 'Good point \u2014 time to pause',
        zone: 'monologue', color: '#ffaa00', priority: 3
      });
    }

    // Track monologue warnings for summary
    if (metrics.continuousSpeechSec > this.monologueWarnSec && candidates.length > 0) {
      this.monologueWarnings++;
    }

    // === Speed checks ===
    if (metrics.wpm > 170) {
      candidates.push({
        message: 'Breathe. Slow down.',
        zone: 'rush', color: '#ff4444', priority: 4
      });
    } else if (metrics.wpm > 150) {
      candidates.push({
        message: 'Slow down a touch',
        zone: 'fast', color: '#ffaa00', priority: 6
      });
    } else if (metrics.wpm >= 120) {
      // Ideal zone — no speed message
    } else if (metrics.wpm > 0 && metrics.wpm < 120) {
      candidates.push({
        message: 'Good pace',
        zone: 'calm', color: '#44dd88', priority: 9
      });
    }

    // === Talk-time checks (only after 60s) ===
    if (metrics.sessionDurationSec > 60) {
      if (metrics.talkPercent > 65) {
        candidates.push({
          message: 'Pause. Ask a question.',
          zone: 'talk-high', color: '#ff6b35', priority: 5
        });
      } else if (metrics.talkPercent > 50) {
        candidates.push({
          message: 'Create space \u2014 let them talk',
          zone: 'talk-med', color: '#ffaa00', priority: 7
        });
      } else if (metrics.talkPercent < 30 && metrics.talkPercent > 0) {
        candidates.push({
          message: "You're listening well",
          zone: 'talk-low', color: '#44dd88', priority: 10
        });
      }
    }

    // === Periodic encouragement ===
    const msSinceEncouragement = now - this.lastEncouragementAt;
    if (metrics.sessionDurationSec > 30 &&
        msSinceEncouragement > this.encourageIntervalMin * 60000 &&
        candidates.length === 0) {
      candidates.push({
        message: this.encouragements[this.encourageIndex % this.encouragements.length],
        zone: 'encourage', color: '#88aaff', priority: 8
      });
      this.lastEncouragementAt = now;
      this.encourageIndex++;
    }

    // Pick highest priority (lowest number)
    candidates.sort((a, b) => a.priority - b.priority);
    const best = candidates[0] || null;

    // Minimum display time: 3 seconds
    if (this.currentMessage && now - this.messageSetAt < 3000) {
      if (!best || best.priority >= this.currentPriority) {
        return this.currentMessage;
      }
    }

    if (best) {
      this.currentMessage = best;
      this.currentPriority = best.priority;
      this.messageSetAt = now;
    } else if (now - this.messageSetAt > 8000) {
      // Clear stale messages after 8s
      this.currentMessage = null;
      this.currentPriority = 99;
    }

    return this.currentMessage;
  }

  getSpeedZone(wpm) {
    if (wpm === 0) return { label: '--', color: '#666666' };
    if (wpm < 120) return { label: 'calm', color: '#44dd88' };
    if (wpm <= 150) return { label: 'ideal', color: '#44dd88' };
    if (wpm <= 170) return { label: 'fast', color: '#ffaa00' };
    return { label: 'rush', color: '#ff4444' };
  }

  getTalkColor(pct) {
    if (pct < 30) return '#44dd88';
    if (pct <= 50) return '#44dd88';
    if (pct <= 65) return '#ffaa00';
    return '#ff6b35';
  }

  reset() {
    this.currentMessage = null;
    this.currentPriority = 99;
    this.messageSetAt = 0;
    this.lastEncouragementAt = 0;
    this.encourageIndex = 0;
    this.monologueWarnings = 0;
  }
}
