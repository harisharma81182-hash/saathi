// Shared process state, read by the readiness check and set by the shutdown handler.
export const lifecycle = {
  shuttingDown: false,
};
