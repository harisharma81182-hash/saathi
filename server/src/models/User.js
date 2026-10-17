import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Only the password hash is stored, never the password itself.
    // select: false means it is never returned by a query unless asked for explicitly.
    passwordHash: { type: String, required: true, select: false },
    // IANA timezone such as "Asia/Kolkata". The agent uses it to understand "kal 5 baje".
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  { timestamps: true },
);

// What the API is allowed to show about a user. Works for both Mongoose documents and plain
// (lean / cached) objects.
export function publicUser(u) {
  return {
    id: String(u._id ?? u.id),
    name: u.name,
    email: u.email,
    timezone: u.timezone,
    createdAt: u.createdAt,
  };
}

export const User = mongoose.model('User', userSchema);
