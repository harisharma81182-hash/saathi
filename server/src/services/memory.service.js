import { z } from 'zod';
import { Memory, MEMORY_KINDS, publicMemory } from '../models/Memory.js';
import { AppError } from '../utils/AppError.js';
import { escapeRegex } from '../utils/schemas.js';

// Long-term memory: short facts about the user that Saathi keeps across conversations.
export const MAX_MEMORIES = 200;

export const rememberSchema = z.object({
  text: z.string().trim().min(3, 'The fact is too short.').max(300, 'Keep a memory under 300 characters.'),
  kind: z.enum(MEMORY_KINDS).default('fact'),
});

// "Classes 9-4, Mon-Fri." and "classes 9-4 mon-fri" are the same memory.
export function memoryKey(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export async function list(userId, { limit = 100 } = {}) {
  const rows = await Memory.find({ userId }).sort({ updatedAt: -1 }).limit(limit).lean();
  return rows.map(publicMemory);
}

export async function remember(userId, { text, kind }, { source = 'agent', sourceMessageId = null } = {}) {
  const key = memoryKey(text);
  const existing = await Memory.findOne({ userId, key });
  if (existing) {
    // Same fact again: just mark it as recent so it stays near the top.
    existing.kind = kind;
    existing.text = text;
    await existing.save();
    return { memory: existing, duplicate: true };
  }
  if ((await Memory.countDocuments({ userId })) >= MAX_MEMORIES) {
    throw AppError.conflict('Memory is full. Delete a few old memories in Settings first.');
  }
  try {
    return { memory: await Memory.create({ userId, text, kind, key, source, sourceMessageId }), duplicate: false };
  } catch (err) {
    // Two requests saved the same fact at the same moment; the other one won.
    if (err?.code === 11000) return { memory: await Memory.findOne({ userId, key }), duplicate: true };
    throw err;
  }
}

export async function search(userId, query, { limit = 10 } = {}) {
  const words = memoryKey(query).split(' ').filter((w) => w.length >= 3);
  if (!words.length) return [];
  const rx = new RegExp(words.map(escapeRegex).join('|'), 'i');
  const rows = await Memory.find({ userId, text: rx }).sort({ updatedAt: -1 }).limit(limit).lean();
  return rows.map(publicMemory);
}

export async function remove(userId, id) {
  const res = await Memory.deleteOne({ _id: id, userId });
  if (res.deletedCount === 0) throw AppError.notFound('Memory not found.');
}
