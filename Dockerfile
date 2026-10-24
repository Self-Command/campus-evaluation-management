# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
# Build-time placeholders only. Real credentials are injected at runtime.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    NEXTAUTH_URL=http://localhost:3000 \
    NEXTAUTH_SECRET=build-only-placeholder-not-used-at-runtime
RUN npm run build

FROM base AS runner
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Campus Evaluation Management" \
      org.opencontainers.image.description="Higher-education comprehensive evaluation management system" \
      org.opencontainers.image.source="https://github.com/Self-Command/campus-evaluation-management" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="Proprietary"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_PATH=/usr/local/lib/node_modules \
    EVIDENCE_DIR=/data/evidence \
    ACTIVITY_ATTACHMENT_DIR=/data/activity-attachments \
    HOME=/home/nextjs

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates dumb-init openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --no-audit --no-fund prisma@7.10.1 bcryptjs@3.0.3 \
    && npm cache clean --force

RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid nextjs --create-home --home-dir /home/nextjs nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next-production/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next-production/static ./.next-production/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --chown=nextjs:nextjs prisma ./prisma
COPY --chown=nextjs:nextjs docker/prisma.config.ts ./prisma.docker.config.ts
COPY --chown=nextjs:nextjs docker/entrypoint.sh docker/wait-for-db.cjs docker/bootstrap-admin.cjs ./docker/

RUN chmod 0755 /app/docker/entrypoint.sh \
    && mkdir -p /data/evidence /data/activity-attachments \
    && chown -R nextjs:nextjs /data /app

USER nextjs
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
