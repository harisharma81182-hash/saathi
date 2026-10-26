// How each kind of notification looks in the app. Same emoji, screen and photo as the push version
// (server/src/utils/notifyStyle.js), plus the glow colour of the in-app card.

const STYLES = {
  reminder: { emoji: '⏰', path: 'reminders', photo: 'blackhole', glow: '242 165 65' },
  study: { emoji: '📖', path: 'reminders', photo: 'cosmicreef', glow: '155 123 255' },
  due_soon: { emoji: '⏳', path: 'tasks', photo: 'antennae', glow: '90 168 255' },
  due_now: { emoji: '✅', path: 'tasks', photo: 'antennae', glow: '33 168 149' },
  nudge: { emoji: '😬', path: 'tasks', photo: 'andromeda', glow: '255 157 92' },
  morning: { emoji: '☀️', path: 'home', photo: 'earth-horizon', glow: '255 200 87' },
  recap: { emoji: '🌙', path: 'home', photo: 'earth-night', glow: '130 140 255' },
  countdown: { emoji: '📅', path: 'tasks', photo: 'pillars', glow: '71 214 195' },
  achievement: { emoji: '🏆', path: 'tasks', photo: 'westerlund2', glow: '255 211 92' },
  agent: { emoji: '💬', path: 'home', photo: 'milkyway-mountains', glow: '242 165 65' },
  system: { emoji: '🔔', path: 'home', photo: 'milkyway', glow: '242 165 65' },
};

export function notifyStyle(n) {
  if (n.kind === 'reminder' && n.data?.study) return STYLES.study;
  return STYLES[n.kind] ?? STYLES.system;
}

/** Is this notification about exactly one task (so "Ho gaya" makes sense)? */
export const oneTask = (n) => Boolean(n.data?.taskId || n.data?.taskIds?.length === 1 || (n.refType === 'task' && n.refId));
