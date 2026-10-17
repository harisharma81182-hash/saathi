// Circuit breaker: stop calling a service that is clearly down.
//
// closed    -> normal; count consecutive failures
// open      -> after `threshold` failures in a row, fail instantly for `cooldownMs`
//              (no point making every user wait 60 s for a timeout we already expect)
// half-open -> after the cooldown, let one trial call through; success closes, failure reopens
export class CircuitBreaker {
  constructor({ threshold = 5, cooldownMs = 30_000, now = () => Date.now() } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  get state() {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  // Returns true if a call may go through right now.
  allow() {
    const s = this.state;
    if (s === 'closed') return true;
    if (s === 'half-open' && !this.trialInFlight) {
      this.trialInFlight = true;
      return true;
    }
    return false;
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  // The call ended without telling us anything about the provider's health
  // (our own bad request, the user cancelled, the local queue was full). Free the trial slot
  // without counting a success or a failure, so a half-open breaker is never stuck.
  release() {
    this.trialInFlight = false;
  }

  failure() {
    this.trialInFlight = false;
    this.failures++;
    if (this.state === 'half-open' || this.failures >= this.threshold) this.openedAt = this.now();
  }

  retryAfterSeconds() {
    if (this.openedAt === null) return 0;
    return Math.max(1, Math.ceil((this.cooldownMs - (this.now() - this.openedAt)) / 1000));
  }
}
