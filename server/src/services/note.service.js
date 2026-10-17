import { z } from 'zod';
import { Note, publicNote } from '../models/Note.js';
import { AppError } from '../utils/AppError.js';
import { tags, pagination, escapeRegex } from '../utils/schemas.js';
import * as activity from './activity.service.js';

export const createNoteSchema = z.object({
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1, 'The note is empty.').max(20_000),
  tags: tags.optional(),
  pinned: z.boolean().optional(),
});

export const updateNoteSchema = createNoteSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const listNotesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  pinned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...pagination,
});

const live = (userId) => ({ userId, deletedAt: null });

export async function list(userId, query) {
  const match = live(userId);
  if (query.tag) match.tags = query.tag;
  if (query.pinned !== undefined) match.pinned = query.pinned;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    match.$or = [{ title: rx }, { body: rx }, { tags: rx }];
  }
  const [rows, total] = await Promise.all([
    Note.find(match)
      .sort({ pinned: -1, updatedAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Note.countDocuments(match),
  ]);
  return { notes: rows.map(publicNote), total, page: query.page, limit: query.limit };
}

export async function get(userId, id) {
  const note = await Note.findOne({ _id: id, ...live(userId) });
  if (!note) throw AppError.notFound('Note not found.');
  return note;
}

const label = (n) => n.title || n.body.slice(0, 40) + (n.body.length > 40 ? '…' : '');

export async function create(userId, data, { actor = 'user' } = {}) {
  const note = await Note.create({ ...data, userId, source: actor });
  await activity.record({ userId, actor, action: 'note.created', entityType: 'note', entity: note, summary: `Saved note "${label(note)}"` });
  return note;
}

async function mutate(userId, id, { actor, action, summary, apply }) {
  const note = await get(userId, id);
  const before = activity.snapshot('note', note);
  apply(note);
  await note.save();
  await activity.record({ userId, actor, action, entityType: 'note', entity: note, before, summary: summary(note) });
  return note;
}

export function update(userId, id, changes, { actor = 'user' } = {}) {
  return mutate(userId, id, {
    actor,
    action: 'note.updated',
    summary: (n) => `Edited note "${label(n)}"`,
    apply: (n) => Object.assign(n, changes),
  });
}

export function remove(userId, id, { actor = 'user' } = {}) {
  return mutate(userId, id, {
    actor,
    action: 'note.deleted',
    summary: (n) => `Deleted note "${label(n)}"`,
    apply: (n) => {
      n.deletedAt = new Date();
    },
  });
}
