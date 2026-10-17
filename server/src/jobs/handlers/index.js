import { registerHandler } from '../worker.js';
import { fireReminder } from './reminder.js';
import { summarize } from './summarize.js';

// Every background job type and the function that runs it.
export function registerAllHandlers() {
  registerHandler('reminder.fire', fireReminder);
  registerHandler('agent.summarize', summarize);
}
