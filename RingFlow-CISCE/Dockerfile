# =========================================================================
# RingFlow Production Dockerfile (Next.js Standalone + Node 22 Alpine)
# =========================================================================

# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment variables needed at build time
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Public client config, baked into the browser bundle. Supplied with
# --build-arg (see docker-compose.yml). NEXT_PUBLIC_REALTIME_URL may be left
# empty: browsers then derive it from the page's own hostname (:4000).
ARG NEXT_PUBLIC_REALTIME_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ARG NEXT_PUBLIC_SUPABASE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_REALTIME_URL=$NEXT_PUBLIC_REALTIME_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
# The production build prerenders pages, which queries the database
# (pre-existing app behavior), so DATABASE_URL must be reachable at build time.
# docker-compose.yml builds with host networking for exactly this reason.
# NOTE: no default value here — baking default credentials into the image
# layer history would leak them to anyone who pulls the image. Pass the build
# arg explicitly (compose does).
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

RUN npm run build

# Stage 3: Migration runner (one-shot). Applies the drizzle journal
# (supabase/migrations) then the idempotent realtime NOTIFY triggers.
# Used by the compose `migrate` service; exits 0 when the DB is current.
FROM node:22-alpine AS migrate
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY drizzle.config.ts ./
COPY supabase/migrations ./supabase/migrations
COPY scripts/migrate-db.mjs ./scripts/migrate-db.mjs
CMD ["node", "scripts/migrate-db.mjs"]

# Stage 4: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy static assets and standalone build
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
