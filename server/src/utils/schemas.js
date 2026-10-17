import mongoose from 'mongoose';
import { z } from 'zod';

// Shared validation pieces used by several routes.

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v), 'Invalid id.');

export const idParams = z.object({ id: objectId });

// Accepts ISO strings with an offset ("2026-10-18T09:00:00+05:30") or UTC ("...Z").
// A date without an offset would be ambiguous (whose 9 AM?), so it is rejected.
export const isoDateTime = z
  .string()
  .refine((v) => /([zZ]|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)), {
    message: 'Use a full date and time with a timezone, e.g. 2026-10-18T09:00:00+05:30.',
  })
  .transform((v) => new Date(v));

export const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(10, 'At most 10 tags.')
  .transform((t) => [...new Set(t)]);

export const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(1).max(1000).default(1),
};

// Makes user text safe to use inside a regular expression search.
export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
