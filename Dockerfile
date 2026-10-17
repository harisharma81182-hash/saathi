# Saathi container image. The same image runs anywhere: Render, Google Cloud Run, Fly.io,
# AWS ECS, or Kubernetes. Choose the role with PROCESS_ROLE (web | worker | all).
#
#   docker build -t saathi .
#   docker run -p 4000:4000 --env-file server/.env saathi

# ---- dependencies (production only) ----
FROM node:22-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    PROCESS_ROLE=all
WORKDIR /app/server

COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/scripts ./scripts

# Never run as root inside the container.
USER node

EXPOSE 4000

# Lets Docker (and platforms that read it) restart a hung container. Uses liveness, not readiness,
# so a database outage does not restart every container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly (not through npm) so it receives SIGTERM and can shut down gracefully.
CMD ["node", "src/index.js"]
