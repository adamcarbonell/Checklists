# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs checklist
COPY --from=builder --chown=checklist:nodejs /app/public ./public
COPY --from=builder --chown=checklist:nodejs /app/.next/standalone ./
COPY --from=builder --chown=checklist:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=checklist:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=checklist:nodejs /app/scripts ./scripts
COPY --from=builder --chown=checklist:nodejs /app/src ./src
COPY --from=builder --chown=checklist:nodejs /app/drizzle ./drizzle
USER checklist
EXPOSE 3000
CMD ["node", "server.js"]
