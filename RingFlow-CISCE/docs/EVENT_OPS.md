# RingFlow Event-Day Operations Runbook

Practical guide for running RingFlow at a tournament: first-time setup,
starting and stopping the stack, health checks, backups, common failures,
and security notes. Pair with `docs/SELF_HOSTED_REALTIME.md` (Realtime
internals) and `docs/PRODUCTION.md` (if present) for architecture detail.

> Convention: run all commands from the `RingFlow-CISCE/` repo root.
> The stack is temporary by design — boot it before the tournament, shut
> it down after. Nothing phones home; the whole thing works offline on
> the event LAN.

## 1. First-time setup (once per machine)

1. **Copy the env template and generate secrets**
   ```sh
   cp .env.example .env
   node scripts/gen-supabase-secrets.mjs   # SUPABASE_JWT_SECRET, SESSION_SECRET, keys…
   ```
   `.env` is gitignored — never commit it. `SESSION_SECRET` signs all
   session cookies (generate with `openssl rand -hex 32` if you ever need
   to rotate it manually; rotating logs everyone out).

2. **Start the event stack**
   ```sh
   ./scripts/start-event.sh
   ```
   This starts `db` + `pooler`, applies pending migrations via the one-shot
   `migrate` service, then starts `realtime` and `app`, and waits until
   `GET /api/health` returns 200.

3. **Seed data (demo or real tournament)**
   ```sh
   npm run db:seed        # realistic demo tournament
   # or your own seed / admin import flow
   ```

4. **Set the first admin password.** On first login the app requires the
   bootstrap password from `ADMIN_BOOTSTRAP_PASSWORD` in `.env`. Change it
   inside the app afterwards, then rotate or delete `ADMIN_BOOTSTRAP_PASSWORD`
   in `.env` (and restart the app service) so the bootstrap value can't be
   reused later.

5. **Tell LAN clients where to connect.** Browsers/tablets open
   `http://<server-lan-ip>:3000`. The browser derives the Realtime socket
   (`:4000`) from the page hostname automatically, so usually nothing
   needs configuring on clients. If your network blocks that, set
   `NEXT_PUBLIC_REALTIME_URL=http://<server-lan-ip>:4000` before building
   the app image.

## 2. Starting and stopping

```sh
docker compose up -d            # start everything (db, pooler, migrate, realtime, app)
docker compose down             # stop everything, keep data (pgdata volume survives)
docker compose down -v          # ⚠ stop AND delete all data — only when the event is archived

docker compose ps               # service status
docker compose logs -f app      # tail app logs (JSON lines; log rotation configured)
docker compose logs -f realtime db
```

`start-event.sh` is the preferred entry point on event day: it runs
migrations before starting the app, so schema is always current.

## 3. Health checks

| Endpoint | Purpose | Used by |
|---|---|---|
| `GET /api/health` | Liveness: app can reach DB + Realtime socket. 503 when degraded | Docker HEALTHCHECK for `app` |
| `GET /api/ready` | Readiness: app is ready to serve traffic | orchestration / load balancers |
| `GET /api/metrics` | Prometheus metrics (HTTP, live events published, bridge leader) | monitoring scrape |

Quick event-day checks:

```sh
curl -sf http://localhost:3000/api/health && echo OK
curl -sf http://localhost:3000/api/ready  && echo READY
```

## 4. Backup & restore

Backups are plain `pg_dump` custom-format files under `./backups/`.

```sh
./scripts/backup-db.sh                  # create timestamped backup, keeps last 10
BACKUP_KEEP=20 ./scripts/backup-db.sh   # keep more

./scripts/restore-db.sh ./backups/ringflow-2026-09-21T080000.dump
./scripts/restore-db.sh --yes ./backups/ringflow-2026-09-21T080000.dump  # skip prompt
```

Restore stops `app`/`realtime`, restores with `pg_restore --clean`, and
prints verification steps. **Rule of thumb:** take a backup right before
the tournament starts and one right after finals. Copy the file off the
server (USB stick is fine) — a backup that lives only on the same disk as
the DB is not a backup.

## 5. Common failures and fixes

**App unhealthy / 503 on /api/health**
Check which check failed in the JSON body (`database` vs `realtime`).
`docker compose logs app` for details. Usually the DB is still starting —
wait 30s and retry; compose healthchecks gate startup order.

**Realtime container keeps restarting**
The `command` runs `/app/bin/migrate && seeds && /app/bin/server`. If the
JWT secret in `.env` changed after the first boot, the seeded tenant no
longer matches: `docker compose down -v` (data loss!) is NOT the fix —
instead re-run the seed step: `docker compose exec realtime /app/bin/realtime eval 'Realtime.Release.seeds(Realtime.Repo)'`.
If it never comes up, `docker compose logs realtime`.

**Live scores stop updating on clients but the app works**
The app publishes events over the Realtime socket; the DB is the source of
truth. Check `docker compose ps` (realtime healthy?) and
`/api/metrics` → `ringflow_live_events_published_total` should be rising
as scores are confirmed. **Clients self-heal:** after any disconnect they
resubscribe and re-fetch the latest state from the server, so a brief
Realtime outage shows stale data, never wrong data. Refreshing the page is
always safe.

**Multiple app instances / bridge failover**
The Realtime LISTEN bridge elects exactly one leader via a Postgres
advisory lock (`ringflow_realtime_bridge_leader` metric = 1 on the leader).
If the leader dies, another instance takes over within seconds; no action
needed. The bridge uses `DATABASE_DIRECT_URL` (direct to Postgres, not the
pooler) because LISTEN does not work through transaction-mode pgBouncer.

**DB disk full**
Postgres stops accepting writes. Free space or move the pgdata volume.
Then: `docker compose restart db`, verify `/api/health`.

**"Connection refused" from LAN clients**
The app binds `0.0.0.0:3000` and realtime binds `:4000` — reachable on the
LAN. The DB port is bound to `127.0.0.1` only, so only the server itself
can reach Postgres directly. Check the server's firewall and that clients
use the server's LAN IP, not `localhost`.

## 6. Single-instance design (read this before scaling)

The event deployment runs **one** app container. Two mechanisms assume this:

- **Realtime bridge leader election** — the app holds a Postgres advisory lock
  (`pg_try_advisory_lock`) before LISTENing for change notifications. If you
  ever run two app containers, only one bridges NOTIFYs to browsers; the
  other skips LISTEN. If the leader's connection drops, the lock releases
  with the session and the survivor (or a reconnecting instance) re-contends —
  failover is automatic, but there is deliberately no active-active bridging.
- **In-memory rate limiter** (`src/lib/rateLimit.ts`) — per-IP throttling for
  access-code attempts lives in process memory. With two app containers an
  attacker gets double the attempts.

Do not scale the app horizontally without replacing these with shared
alternatives (e.g. Redis). For a tournament, one container is plenty —
25+ realtime connections and the associated Postgres writes are trivial load.

## 7. Security notes

- **SESSION_SECRET** — signs every session cookie. Anyone with this value
  can forge admin sessions. Keep `.env` off shared machines, rotate if
  exposed (everyone gets logged out).
- **ADMIN_BOOTSTRAP_PASSWORD** — required for the very first admin login;
  remove or rotate it after creating the real admin account. There is no
  hardcoded fallback password. **After the first login, rotate it
  immediately**: change the admin password inside the app, then either delete
  `ADMIN_BOOTSTRAP_PASSWORD` from `.env` or replace it with a fresh random
  value (`openssl rand -hex 16`) and restart the app service. A bootstrap
  password left in `.env` indefinitely is a standing backdoor — anyone who
  reads the file can mint an admin session.
- **Dev-admin bypass is disabled in production** — `loginAsDevAdmin`
  throws when `NODE_ENV=production`; the unsigned `admin_dev_id` cookie is
  honored only in development.
- **Turnstile is off by default** (`TURNSTILE_ENABLED` unset) so the event
  LAN works without internet. Enable it only if the server is reachable
  from the public internet.
- **Score mutations are authorized server-side** — moderator ring tokens,
  organiser codes, and admin sessions are verified before any write; the
  Realtime socket only broadcasts change notifications and never accepts
  writes from clients.
- File uploads are PDF-only (10 MB cap), stored under
  `FILE_STORAGE_DIR` (default `./storage`) with strict key validation —
  no path traversal.

## 8. Judge access (venue WiFi vs tunnel)

Judges score from their own phones. They reach the judge pages (`/j/*`)
in one of two ways, tried in this order:

1. **Venue WiFi (recommended)** — server fully offline. Judges open the
   venue-LAN address of the server. Nothing to configure: with no judge
   base URL set, judge links are relative (`/j/…`) and work on the event
   network.
2. **Public tunnel** — judges on their own mobile data. Run the tunnel on
   the server machine and point the app at it (steps below).
3. **Moderator-entered scores** — last resort. If neither of the above
   works, the moderator types the missing judges' scores in by hand from
   the tatami console. Bouts may start even when not all judge seats are
   filled.

### Event-day steps (tunnel mode)

1. On the server machine:
   ```sh
   ./scripts/start-judge-tunnel.sh
   ```
   The script prints a public URL like
   `https://something-random.trycloudflare.com`. Keep it running for the
   whole event (Ctrl+C stops the tunnel).
2. In the app, open **Settings → Judge access**, paste the printed URL
   into **Judge access URL**, and press **SAVE**.
3. Press **TEST**. The server fetches `<url>/api/health` and compares its
   per-boot instance ID with its own:
   - Green *"Live — this URL reaches this server"* → safe to print QR codes.
   - Red → the URL does not reach this server. Check for a typo, a stale
     URL from a previous tunnel run (the URL is random **per run** — a
     new run needs a new paste + Test), or a stopped tunnel.
4. Print the judge QR cards from the tatami consoles (they encode the
   tested base URL). Scanning a QR code only opens the join page —
   nothing is granted until the moderator approves the named judge seat.

Notes:

- The Test result (and its timestamp) is saved with the setting, so the
  next shift can see at a glance that the link is live.
- If the `JUDGE_BASE_URL` env var is set, it wins over the saved value
  and the Settings field becomes read-only — manage the URL in the env
  file instead. To switch back to venue-WiFi mode, clear the field (or
  the env var) so the effective URL is empty.
- Judges through the tunnel can reach **only** `/j/*` and other public
  endpoints. Staff pages (`/admin`, `/moderator`, `/organiser`, `/stager`)
  return 404 for public client IPs — the tunnel never exposes staff
  controls to the internet (see `src/proxy.ts`).
- `GET /api/judge-access/status` (admin session required) reports
  `{ mode: "wifi" | "tunnel", baseUrl, lastTest }` for consoles that want
  to poll judge-link health.
