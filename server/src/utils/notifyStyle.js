// How each kind of notification looks, in one place: its emoji, which screen opens on click, the
// space photo shown with it on Chrome/Android (from client/public/bg, credits in CREDITS.md), and
// whether it is important enough for an email when push can't reach the user.

export const STYLES = {
  reminder: { emoji: '⏰', path: '/#/reminders', photo: 'blackhole', email: true, quietHoursOk: true },
  study: { emoji: '📖', path: '/#/reminders', photo: 'cosmicreef', email: true, quietHoursOk: true },
  due_soon: { emoji: '⏳', path: '/#/tasks', photo: 'antennae', email: true },
  due_now: { emoji: '✅', path: '/#/tasks', photo: 'antennae', email: true },
  nudge: { emoji: '😬', path: '/#/tasks', photo: 'andromeda' },
  morning: { emoji: '☀️', path: '/', photo: 'earth-horizon', email: true },
  recap: { emoji: '🌙', path: '/', photo: 'earth-night' },
  countdown: { emoji: '📅', path: '/#/tasks', photo: 'pillars' },
  achievement: { emoji: '🏆', path: '/#/tasks', photo: 'westerlund2' },
  agent: { emoji: '💬', path: '/', photo: 'milkyway-mountains' },
  system: { emoji: '🔔', path: '/', photo: 'milkyway' },
};

/** The style of one notification (a reminder for a study-plan session gets the study look). */
export function styleOf(notification) {
  if (notification.kind === 'reminder' && notification.data?.study) return STYLES.study;
  return STYLES[notification.kind] ?? STYLES.system;
}

// Quiet hours, in the user's own time: only reminders (which the user set for that time) go out.
export const QUIET_HOURS = { from: 23, to: 7 };
export const inQuietHours = (localHour) => localHour >= QUIET_HOURS.from || localHour < QUIET_HOURS.to;

/** Buttons on the notification. Most devices show at most two; opening is the click itself. */
export function actionsFor(notification) {
  const oneTask = notification.refType === 'task' || notification.data?.taskIds?.length === 1 || notification.data?.taskId;
  if (notification.kind === 'reminder') {
    return notification.data?.taskId
      ? [{ action: 'done', title: 'Ho gaya ✅' }, { action: 'snooze', title: '10 min baad 😴' }]
      : [{ action: 'snooze', title: '10 min baad 😴' }, { action: 'open', title: 'Kholo' }];
  }
  if (['due_soon', 'due_now', 'nudge'].includes(notification.kind) && oneTask) {
    return [{ action: 'done', title: 'Ho gaya ✅' }, { action: 'open', title: 'Kholo' }];
  }
  return [{ action: 'open', title: 'Kholo' }];
}
