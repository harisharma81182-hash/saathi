import mongoose from 'mongoose';
import { DEFAULT_LANGUAGE, LANGUAGE_IDS } from '../utils/language.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Only the password hash is stored, never the password itself.
    // select: false means it is never returned by a query unless asked for explicitly.
    passwordHash: { type: String, required: true, select: false },
    // IANA timezone such as "Asia/Kolkata". The agent uses it to understand "kal 5 baje".
    timezone: { type: String, default: 'Asia/Kolkata' },
    // Preferred language from Settings ("Bhasha"), see utils/language.js.
    language: { type: String, enum: LANGUAGE_IDS, default: DEFAULT_LANGUAGE },
    // Goes up when the password is reset. Login tokens carry the number they were issued with, so
    // every older session stops working at once ("log out everywhere").
    sessionVersion: { type: Number, default: 0 },
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
    language: u.language ?? DEFAULT_LANGUAGE,
    createdAt: u.createdAt,
  };
}

export const User = mongoose.model('User', userSchema);
