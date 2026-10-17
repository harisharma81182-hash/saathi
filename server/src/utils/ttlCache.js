// A tiny in-memory cache with a time limit and a size limit.
// Map keeps insertion order, so the first key is always the oldest and is evicted first.
//
// Each instance has its own copy, so after a change on one instance another may serve the old value
// until ttlMs passes. Only cache things where a short delay like that is acceptable.
export class TtlCache {
  constructor({ ttlMs, maxEntries = 10_000 }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}
