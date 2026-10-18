import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idempotent } from '../middleware/idempotency.js';
import { idParams } from '../utils/schemas.js';
import { publicTask } from '../models/Task.js';
import * as tasks from '../services/task.service.js';
import * as habits from '../services/habit.service.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get('/', validate({ query: tasks.listTasksSchema }), async (req, res) => {
  res.json(await tasks.list(req.user, req.valid.query));
});

tasksRouter.post('/', idempotent(), validate({ body: tasks.createTaskSchema }), async (req, res) => {
  const task = await tasks.create(req.user._id, req.valid.body);
  res.status(201).json({ task: publicTask(task) });
});

// Habits (repeating tasks): the current occurrence of each, with its streak.
tasksRouter.get('/habits', async (req, res) => {
  res.json({ habits: await habits.list(req.user) });
});

tasksRouter.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ task: publicTask(await tasks.get(req.user._id, req.valid.params.id)) });
});

tasksRouter.patch('/:id', validate({ params: idParams, body: tasks.updateTaskSchema }), async (req, res) => {
  const task = await tasks.update(req.user._id, req.valid.params.id, req.valid.body);
  res.json({ task: publicTask(task) });
});

tasksRouter.post('/:id/complete', validate({ params: idParams }), async (req, res) => {
  const task = await tasks.complete(req.user._id, req.valid.params.id);
  // For a habit, the next occurrence that was just created.
  res.json({ task: publicTask(task), next: task.$locals.next ? publicTask(task.$locals.next) : null });
});

tasksRouter.post('/:id/reopen', validate({ params: idParams }), async (req, res) => {
  res.json({ task: publicTask(await tasks.reopen(req.user._id, req.valid.params.id)) });
});

tasksRouter.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await tasks.remove(req.user._id, req.valid.params.id);
  res.status(204).end();
});
