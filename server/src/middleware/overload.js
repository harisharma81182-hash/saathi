import { monitorEventLoopDelay } from 'node:perf_hooks';

// Protects an instance during a traffic spike.
//
// Node runs all JavaScript on one thread (the event loop). When it is overloaded, the delay before it
// gets to the next piece of work ("event loop lag") grows, and every request slows down together.
// Instead of letting latency climb for everyone, an overloaded instance answers new requests with a
// quick 503 + Retry-After. Health checks are never shed, so the platform does not think the instance
// is dead and kill it while it is merely busy; the autoscaler sees the load and adds instances.
export function createOverloadGuard({ maxLagMs = 200, sampleMs = 500 } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  let lagMs = 0;
  const interval = setInterval(() => {
    lagMs = histogram.percentile(99) / 1e6; // nanoseconds -> ms
    histogram.reset();
  }, sampleMs);
  interval.unref();

  const middleware = (req, res, next) => {
    if (lagMs > maxLagMs && !req.path.startsWith('/api/health')) {
      res.set('Retry-After', '2');
      return res.status(503).json({
        error: { code: 'OVERLOADED', message: 'The server is very busy right now. Try again in a few seconds.' },
      });
    }
    next();
  };

  return {
    middleware,
    lagMs: () => lagMs,
    stop: () => {
      clearInterval(interval);
      histogram.disable();
    },
  };
}
