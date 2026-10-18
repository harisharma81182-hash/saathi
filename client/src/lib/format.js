// Friendly Hinglish-ish time labels for the UI ("Aaj 6:00 PM", "Kal 9:00 AM", "Mon 21 Oct").

const time = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return `Aaj ${time(d)}`;
  if (days === 1) return `Kal ${time(d)}`;
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date}, ${time(d)}`;
}

export function clock(iso) {
  return iso ? time(new Date(iso)) : '';
}

/** "2 din se" for overdue items. */
export function lateBy(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60_000);
  if (mins < 60) return `${mins} min late`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ghante late`;
  return `${Math.round(hours / 24)} din se pending`;
}

// What Saathi is doing while a tool runs, shown under its reply.
export const TOOL_LABELS = {
  create_task: 'Task bana raha hoon',
  list_tasks: 'Tasks dekh raha hoon',
  update_task: 'Task badal raha hoon',
  complete_task: 'Done mark kar raha hoon',
  delete_task: 'Delete ke liye pooch raha hoon',
  save_note: 'Note save kar raha hoon',
  search_notes: 'Notes dhoondh raha hoon',
  set_reminder: 'Reminder laga raha hoon',
  list_reminders: 'Reminders dekh raha hoon',
  snooze_reminder: 'Reminder aage kar raha hoon',
  cancel_reminder: 'Reminder hata raha hoon',
  get_today: 'Aaj ka din dekh raha hoon',
  remember_fact: 'Yaad rakh raha hoon',
  recall: 'Yaad kar raha hoon',
  undo_last_action: 'Undo kar raha hoon',
  make_study_plan: 'Study plan bana raha hoon',
  plan_my_day: 'Din plan kar raha hoon',
};
