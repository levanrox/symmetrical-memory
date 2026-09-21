#!/bin/sh
# RingFlow event-day startup — one command to bring up the whole stack.
#
#   ./scripts/start-event.sh
#
# Does, in order:
#   1. checks .env exists (secrets) — else points at gen-supabase-secrets.mjs
#   2. starts db + pooler, waits for Postgres to be healthy
#   3. builds the migrate/app images if missing, runs the one-shot migrate job
#   4. starts realtime + app, waits for the app /api/health to report ok
#   5. prints the LAN URLs and next steps
#
# POSIX sh. Requires: docker (with the compose plugin), curl.
set -eu

cd "$(dirname "$0")/.."

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ── Preconditions ─────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found."
command -v curl >/dev/null 2>&1 || die "curl is not installed or not on PATH."

[ -f .env ] || die "no .env file found. Run first: node scripts/gen-supabase-secrets.mjs"

# ── 1. Data layer ─────────────────────────────────────────────────────────────
say "==> Starting db + pooler..."
docker compose up -d db pooler

say "==> Waiting for Postgres to be healthy..."
t=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' ringflow-db 2>/dev/null)" = "healthy" ]; do
  t=$((t + 2))
  [ "$t" -ge 90 ] && die "db did not become healthy in 90s. See: docker compose logs db"
  sleep 2
done
say "    db is healthy."

# ── 2. Migrations (one-shot) ──────────────────────────────────────────────────
if ! docker image inspect ringflow-migrate >/dev/null 2>&1; then
  say "==> Building migrate image (first run)..."
  docker compose build migrate
fi
say "==> Running migrations (one-shot)..."
if ! docker compose up migrate; then
  die "migrations failed. See: docker compose logs migrate"
fi
say "    migrations applied."

# ── 3. Realtime + app ─────────────────────────────────────────────────────────
if ! docker image inspect ringflow-app >/dev/null 2>&1; then
  say "==> Building app image (first run — this takes a few minutes)..."
  say "    (the Next.js build prerenders pages, so db must be up — it is.)"
  docker compose build app
fi
say "==> Starting realtime + app..."
docker compose up -d realtime app

say "==> Waiting for the app to report healthy..."
t=0
until curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3000/api/health; do
  t=$((t + 3))
  [ "$t" -ge 180 ] && die "app did not become healthy in 180s. See: docker compose logs app"
  sleep 3
done

# ── 4. Summary ────────────────────────────────────────────────────────────────
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$LAN_IP" ] || LAN_IP="<server-lan-ip>"
say ""
say "=============================================================="
say " RingFlow is up."
say "   App (browsers):      http://${LAN_IP}:3000"
say "   Realtime (WebSocket): ws://${LAN_IP}:4000"
say "=============================================================="
say ""
say "Next steps:"
say "  1. First run only — create the admin account:"
say "       - put a strong password in ADMIN_BOOTSTRAP_PASSWORD in .env"
say "       - restart the app: docker compose up -d app"
say "       - log in at http://${LAN_IP}:3000/admin, then REMOVE the password from .env"
say "  2. Seed tournament data from the host if this is a fresh DB:"
say "       npm run db:seed   (DATABASE_URL in .env.local pointing at 127.0.0.1:5432)"
say "  3. LAN clients were baked with NEXT_PUBLIC_REALTIME_URL at build time."
say "     If it was empty, browsers derive ws://<page-host>:4000 automatically."
say ""
say "To stop everything:  docker compose down"
say "To view logs:        docker compose logs -f app"
