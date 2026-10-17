import { AppError } from '../utils/AppError.js';

// Turns zod issues into a list the frontend can show next to each form field.
export function formatIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join('.') || null,
    message: issue.message,
  }));
}

// Usage: router.post('/', validate({ body: schema }), handler)
// Replaces req.body / req.query / req.params with the parsed, cleaned values.
export function validate(schemas) {
  return (req, _res, next) => {
    for (const key of ['body', 'query', 'params']) {
      if (!schemas[key]) continue;
      const result = schemas[key].safeParse(req[key] ?? {});
      if (!result.success) {
        const details = formatIssues(result.error.issues);
        return next(AppError.badRequest(details[0]?.message ?? 'Invalid input.', details));
      }
      // Express 5 makes req.query a getter, so store parsed values on req.valid instead.
      req.valid = { ...req.valid, [key]: result.data };
    }
    next();
  };
}
