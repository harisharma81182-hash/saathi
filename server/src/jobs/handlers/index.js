import { registerHandler } from '../worker.js';
import { fireReminder } from './reminder.js';
import { summarize } from './summarize.js';
import { runScan } from '../../services/proactive.service.js';
import { deliver } from '../../services/delivery.service.js';
import { checkAchievement, dueScan } from '../../services/alerts.service.js';
import { timeUp } from '../../services/focus.service.js';
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
  // Every 5 minutes: tasks due in about an hour, and tasks due now.
  registerHandler('alerts.scan', async ({ slot }) => {
    await ensurePeriodicJobs(new Date(slot));
    return dueScan();
  });
  // Push and email for one notification (services/delivery.service.js).
  registerHandler('notification.deliver', ({ notificationId }) => deliver(notificationId));
  // A task was completed: maybe a streak or weekly milestone to celebrate.
  registerHandler('achievement.check', ({ userId }) => checkAchievement(userId));
  // A focus timer reached its end time.
  registerHandler('focus.end', (payload) => timeUp(payload));
}
