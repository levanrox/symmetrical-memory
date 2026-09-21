# Self-hosted Supabase Realtime

RingFlow uses self-hosted **Supabase Realtime** (broadcast only) for live
screen updates. Only two Supabase services are in play:

| Service    | Role                                                                 |
| ---------- | -------------------------------------------------------------------- |
| PostgreSQL | Source of truth. Drizzle ORM talks to it directly, as before.        |
| Realtime   | WebSocket broadcast channel. Carries change *notifications* only.     |

Deliberately **not** used: Kong, PostgREST, Auth/GoTrue, Storage, Studio, Edge
Functions. The app keeps its own cookie-session auth; every data re-read still
goes through the existing session-authenticated server actions.

## How it flows

```
Server action → Drizzle → PostgreSQL ──(trigger pg_notify)──▶ LISTEN bus
                                                              (one DB connection)
                                                                    │
                                                                    ▼
                                                         realtimeBridge
                                                                    │  service_role key
                                                                    ▼
                                              Supabase Realtime ──▶ browsers (anon key)
                                              broadcast channel         │
                                                              `ringflow:live`
                                                                        ▼
                                                              useLiveEvents → refetch
                                                              via server actions
```

- The existing `ringflow_notify()` triggers (`supabase/migrations/migration8_realtime_notify.sql`)
  already emit structured `LiveEvent`s (table/op/ids/scope ids) on `pg_notify`.
- `src/lib/realtime/realtimeBridge.ts` (started once per server process from
  `src/instrumentation.ts`) republishes each event to Realtime. No server
  action was changed.
- `src/hooks/useLiveEvents.ts` subscribes to the broadcast channel, filters
  with the existing `eventMatchesScope`, and calls `onChange` so the screen
  refetches. Same hook API as before — all screens work unchanged.
- A reconnect triggers a refetch, so a client that missed events resynchronizes
  instead of assuming it saw everything. While disconnected, the existing
  polling fallbacks keep screens alive.

Broadcast (not Postgres Changes / logical replication) was chosen on purpose:
no `wal_level` changes, no publications or RLS to manage, payloads keep the
app's enriched event shape, and only the server can publish.

## Starting the services

```bash
node scripts/gen-supabase-secrets.mjs  # once: writes missing secrets to .env
docker compose up -d db realtime       # postgres + realtime
npm run db:push && npm run db:seed     # schema + seed (DATABASE_URL in .env.local)

# Production app — either as a compose service or on the host:
docker compose build app && docker compose up -d app   # see note below
# …or on the host:
npm run build && npm start               # REALTIME_URL=http://localhost:4000
```

> **Note:** the app's production build prerenders pages, which queries the
> database (pre-existing app behavior, unrelated to realtime). That is why the
> compose `app` service builds with host networking and a `DATABASE_URL` build
> arg: the `db` service must already be running (and migrated) before you build
> the app image. The sequence above does this in the right order — a single
> `docker compose up --build` on a fresh machine would try to build the app
> before the database exists. On Docker Desktop (Mac/Windows) prefer the host
> workflow (`npm run build && npm start`) instead of the compose `app` service.

Stop everything: `docker compose down`. Data survives in the `ringflow-pgdata`
volume; `docker compose down -v` wipes it.

## Environment variables

| Variable | Where | Purpose |
| -------- | ----- | ------- |
| `POSTGRES_PASSWORD` | `.env` (generated) | compose `db` password; keep URL-safe |
| `SUPABASE_JWT_SECRET` | `.env` (generated) | signs anon/service-role JWTs; realtime `API_JWT_SECRET` |
| `SECRET_KEY_BASE` | `.env` (generated) | realtime Phoenix secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env` (generated) | public key browsers subscribe with |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` (generated) | server-only key the app publishes with |
| `REALTIME_URL` | `.env.local` / compose | server → realtime (`http://localhost:4000` on host, `http://realtime:4000` in compose) |
| `NEXT_PUBLIC_REALTIME_URL` | build-time | browsers → realtime. LAN events: `http://<server-lan-ip>:4000`. May be left empty — browsers then use the page's hostname on port 4000. |

## Verifying realtime works

1. `docker compose ps` — `db` and `realtime` healthy.
2. `node scripts/test-realtime.mjs` — subscribes and prints events.
3. In another terminal, change something (e.g. save a score in the app, or
   `psql "$DATABASE_URL" -c "UPDATE matches SET aka_score = aka_score + 1 …"`).
4. The test script prints the `LiveEvent`; open two app screens and watch them
   update without refresh.

## Limitations / operational notes

- **Troubleshooting the realtime container.** If `ringflow-realtime` crash-loops,
  check `docker compose logs realtime`. The compose file pins the image tag and
  runs migrate + tenant seed explicitly; if a future image changes those release
  paths, remove the `command:` override (the image's default entrypoint may
  already handle it).
- **One realtime node.** Broadcast is in-memory in the single container; do not
  scale `realtime` beyond 1 replica without shared clustering.
- **Clients are subscribe-only by convention.** Anyone on the LAN holding the
  anon key could publish to the channel; payloads are id-only notifications and
  all reads stay behind app auth, so the blast radius is a spurious refetch.
- **Event ordering/duplicates.** An action's instant broadcast and the trigger's
  post-commit NOTIFY can both arrive; screens debounce and refetch idempotently.
- **Realtime is optional at runtime.** If the container or keys are missing, the
  bridge logs once and the app keeps working (screens fall back to polling).
- **LAN reachability.** Browsers need `ws://<server-ip>:4000` reachable. If the
  server IP changes, either set `NEXT_PUBLIC_REALTIME_URL` before building or
  leave it empty and let browsers derive it from the page hostname.
