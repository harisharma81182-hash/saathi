import { registerHandler } from '../worker.js';
import { fireReminder } from './reminder.js';
import { summarize } from './summarize.js';
import { runScan } from '../../services/proactive.service.js';
import { ensurePeriodicJobs } from '../periodic.js';

// Every background job type and the function that runs it.
export function registerAllHandlers() {
  registerHandler('reminder.fire', fireReminder);
  registerHandler('agent.summarize', summarize);
  // Every 30 minutes: queue the next run first (so a failure never ends the chain), then scan.
  registerHandler('proactive.scan', async ({ slot }) => {
    await ensurePeriodicJobs(new Date(slot));
    return runScan();
  });
}
