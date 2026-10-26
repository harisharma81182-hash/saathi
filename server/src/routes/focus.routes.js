import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../utils/schemas.js';
import * as focus from '../services/focus.service.js';

// The focus timer. GET /current is what the app shows at the top of every screen.
export const focusRouter = Router();
focusRouter.use(requireAuth);

focusRouter.get('/current', async (req, res) => {
  res.json({ focus: await focus.current(req.user._id) });
});

focusRouter.post('/', validate({ body: focus.startSchema }), async (req, res) => {
  res.status(201).json({ focus: await focus.start(req.user, req.valid.body) });
});

focusRouter.post('/:id/pause', validate({ params: idParams }), async (req, res) => {
  res.json({ focus: await focus.pause(req.user, req.valid.params.id) });
});
focusRouter.post('/:id/resume', validate({ params: idParams }), async (req, res) => {
  res.json({ focus: await focus.resume(req.user, req.valid.params.id) });
});
focusRouter.post('/:id/extend', validate({ params: idParams, body: focus.extendSchema }), async (req, res) => {
  res.json({ focus: await focus.extend(req.user, req.valid.params.id, req.valid.body) });
});
focusRouter.post('/:id/finish', validate({ params: idParams, body: focus.finishSchema }), async (req, res) => {
  res.json(await focus.finish(req.user, req.valid.params.id, req.valid.body));
});
focusRouter.post('/:id/cancel', validate({ params: idParams }), async (req, res) => {
  res.json({ focus: await focus.cancel(req.user, req.valid.params.id) });
});
