/**
 * Accumulates voice-channel time between join/leave transitions and converts
 * it into AZRA voice-minute activity amounts. Pure state machine — testable
 * without discord.js.
 */
export class VoiceTracker {
  #joins = new Map();

  join(guildId, userId, at = Date.now()) {
    this.#joins.set(`${guildId}:${userId}`, at);
  }

  /**
   * Returns { minutes, joinedAt, leftAt } or null when there was no tracked
   * join. Minimum 1 minute so quick hops still count as presence.
   */
  leave(guildId, userId, at = Date.now()) {
    const key = `${guildId}:${userId}`;
    const joinedAt = this.#joins.get(key);
    this.#joins.delete(key);
    if (joinedAt == null) return null;
    return {
      minutes: Math.max(1, Math.round((at - joinedAt) / 60_000)),
      joinedAt: new Date(joinedAt).toISOString(),
      leftAt: new Date(at).toISOString(),
    };
  }

  size() {
    return this.#joins.size;
  }

  clear() {
    this.#joins.clear();
  }
}
