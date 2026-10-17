import { AppError } from './AppError.js';

// Limits how many async jobs run at once, with a bounded waiting line.
//
// Why bounded: an unbounded queue under a traffic spike just grows until memory runs out or
// every request times out. Refusing early with "busy, retry shortly" keeps the instance healthy
// and lets the load balancer and client retry elsewhere or later. This is called load shedding.
export class Semaphore {
  constructor({ max, maxQueue = Infinity, queueTimeoutMs = Infinity, name = 'semaphore' }) {
    this.max = max;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
    this.name = name;
    this.active = 0;
    this.waiting = [];
  }

  stats() {
    return { name: this.name, active: this.active, waiting: this.waiting.length, max: this.max };
  }

  async run(fn) {
    await this.#acquire();
    try {
      return await fn();
    } finally {
      this.#release();
    }
  }

  #acquire() {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) {
      return Promise.reject(busy(this.name, 'queue is full'));
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      if (Number.isFinite(this.queueTimeoutMs)) {
        entry.timer = setTimeout(() => {
          const i = this.waiting.indexOf(entry);
          if (i !== -1) this.waiting.splice(i, 1);
          reject(busy(this.name, 'waited too long'));
        }, this.queueTimeoutMs);
        entry.timer.unref?.();
      }
      this.waiting.push(entry);
    });
  }

  #release() {
    const next = this.waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(); // hand the slot straight to the next waiter; active count stays the same
    } else {
      this.active--;
    }
  }
}

function busy(name, why) {
  const err = new AppError(503, 'BUSY', 'The server is busy right now. Try again in a few seconds.');
  err.retryAfterSeconds = 5;
  err.internal = `${name}: ${why}`;
  return err;
}
