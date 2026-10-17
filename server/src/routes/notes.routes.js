import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idempotent } from '../middleware/idempotency.js';
import { idParams } from '../utils/schemas.js';
import { publicNote } from '../models/Note.js';
import * as notes from '../services/note.service.js';

export const notesRouter = Router();
notesRouter.use(requireAuth);

notesRouter.get('/', validate({ query: notes.listNotesSchema }), async (req, res) => {
  res.json(await notes.list(req.user._id, req.valid.query));
});

notesRouter.post('/', idempotent(), validate({ body: notes.createNoteSchema }), async (req, res) => {
  const note = await notes.create(req.user._id, req.valid.body);
  res.status(201).json({ note: publicNote(note) });
});

notesRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ note: publicNote(await notes.get(req.user._id, req.valid.params.id)) });
});

notesRouter.patch('/:id', validate({ params: idParams, body: notes.updateNoteSchema }), async (req, res) => {
  res.json({ note: publicNote(await notes.update(req.user._id, req.valid.params.id, req.valid.body)) });
});

notesRouter.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await notes.remove(req.user._id, req.valid.params.id);
  res.status(204).end();
});
