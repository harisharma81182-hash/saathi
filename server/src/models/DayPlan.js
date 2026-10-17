import mongoose from 'mongoose';

// "Plan my day": today's open tasks arranged into time slots around the user's classes.
// One plan per user per local date; planning again replaces it. Shown as a timeline on the
// Today panel.
const slotSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // "HH:mm" in the user's timezone
    end: { type: String, required: true },
    label: { type: String, required: true, maxlength: 200 },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  },
  { _id: false },
);

const dayPlanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // local date, "2026-10-18"
    slots: { type: [slotSchema], default: [] },
    note: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true },
);

dayPlanSchema.index({ userId: 1, date: 1 }, { unique: true });

export function publicDayPlan(p) {
  return {
    date: p.date,
    slots: p.slots.map((s) => ({ start: s.start, end: s.end, label: s.label, taskId: s.taskId ? String(s.taskId) : null })),
    note: p.note,
    updatedAt: p.updatedAt,
  };
}

export const DayPlan = mongoose.model('DayPlan', dayPlanSchema);
