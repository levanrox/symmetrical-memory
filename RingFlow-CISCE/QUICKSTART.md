# Quickstart Guide: Local Setup (Docker)

How to run RingFlow on your machine. Requires a PostgreSQL database, the PostgREST
container from `docker-compose.yml`, and the little gateway script.

---

## How the database actually works (read this first)

RingFlow talks to PostgreSQL through **two different layers**. This is the part that
confuses everyone, so it is worth two minutes.

| Layer | Config | Connects to | Used by |
| :--- | :--- | :--- | :--- |
| **Drizzle ORM** | `DATABASE_URL` | `127.0.0.1:5432` | Server actions, scripts, seeding, draws |
| **Supabase JS** | `NEXT_PUBLIC_SUPABASE_URL` | `127.0.0.1:54321` (gateway) | Almost every page, live subscriptions, PDF storage |

Both point at the **same** database — they are just different doors into it.

Three consequences you must know:

1. **PostgREST must be running**, or pages that use the Supabase client will error.
   That is the `postgrest` service in `docker-compose.yml`.
2. **The URL must be the gateway on port 54321, not PostgREST directly.**
   `supabase-js` requests paths like `/rest/v1/tournaments`, but PostgREST serves at
   the *root* (`/tournaments`). `scripts/postgrest-gateway.cjs` strips the `/rest/v1`
   prefix and forwards to PostgREST — that is why it exists and why you run `npm run gateway`.
3. **PostgREST is bound to 54323, not the usual 54322.** 54322 frequently collides with
   other local tooling. `PGRST_SERVER_PORT` overrides it in both the compose file and the gateway.

---

## Step 0: Check you have a database

The setup assumes a PostgreSQL with role `event_suite`, database `ringflow`:

```bash
PGPASSWORD=event_suite psql -h 127.0.0.1 -p 5432 -U event_suite -d ringflow -c '\dt'
```

If that lists tables (or errors with "database does not exist"), continue below. If you
have **no** PostgreSQL at all, use the optional container instead — see
"Option B: no Postgres installed" at the end.

---

## Step-by-step

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env.local
```

The template already contains working local values: `DATABASE_URL`, the gateway URL, and
the two local JWTs signed with the PostgREST secret from `docker-compose.yml`. Normally
nothing needs changing.

### 3. Start PostgREST (leave it running)

```bash
docker compose up -d postgrest
```

It runs in the host network namespace so it can reach a PostgreSQL listening on the host's
loopback (the native Ubuntu package does, and loopback is not reachable from the docker
bridge), and binds `127.0.0.1:54323`.

Check it connected:

```bash
docker compose logs --tail=5 postgrest      # look for "Successfully connected to PostgreSQL"
```

### 4. Start the gateway (second terminal, leave it running)

```bash
npm run gateway
```

### 5. Create the tables — only if the database is empty

```bash
npm run db:push
npm run db:seed        # optional demo data: admin@ringflow.org / admin123
```

> **Do not run `supabase/master.sql` locally.** It creates `ENUM` types and a `storage`
> schema that only exist on a real Supabase project, and its columns do not match the
> Drizzle schema. `db:push` is the correct local path.

### 6. Run the app (third terminal)

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Or: one command

Steps 3, 4 and 6 are bundled:

```bash
npm run dev:local
```

This starts `postgrest` (waiting for health), then the gateway and `next dev` together.

---

## Where to go in the app

| Surface | URL | Notes |
| :--- | :--- | :--- |
| Public home | `/` | No login |
| Admin login | `/login/admin` | Seeded credentials are `admin@ringflow.org` / `admin123` |
| Admin dashboard | `/admin` | Pick a tournament |
| Moderator login | `/login/mod` | Needs a ring access code (`RING01`…) |
| Ring / scoreboard | linked from the admin dashboard | Uses ring IDs from the database |

---

## Environment variables

| Variable | Purpose |
| :--- | :--- |
| `DATABASE_URL` | Drizzle / `postgres` driver → Postgres on `:5432` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase JS client → the gateway on `:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Local JWT (role `event_suite`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same local JWT; used for elevated actions |
| `PGRST_SERVER_PORT` | Optional. Port PostgREST binds / the gateway targets (default 54323) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare test keys (always pass) |

---

## Useful npm scripts

| Script | What it does |
| :--- | :--- |
| `npm run dev` | Next.js dev server on `:3000` (forces `NODE_ENV=development`) |
| `npm run dev:local` | postgrest + gateway + Next, one command |
| `npm run gateway` | PostgREST gateway (`:54321` → PostgREST) |
| `npm run db:push` | Apply the Drizzle schema to the database |
| `npm run db:seed` | Seed the demo tournament |
| `npm run build` / `npm run start` | Production build and serve |
| `npm run lint` | ESLint |

---

## Troubleshooting

**Everything looks fine but pages show no data, or actions fail.**
The gateway is the usual culprit:

```bash
curl -s "http://127.0.0.1:54321/rest/v1/tournaments?limit=1"
```

* `200` with JSON → good.
* `404` → the request isn't reaching the gateway, or `NEXT_PUBLIC_SUPABASE_URL` is not `http://127.0.0.1:54321`.
* `502` / connection error → the gateway is running but PostgREST is not (`docker compose ps`).

**`docker compose up` fails with "address already in use".**
Another process owns the port. Check who with `ss -ltnp | grep <port>`. If it's 54322,
that is exactly why this repo uses 54323; set `PGRST_SERVER_PORT` to a free port for both
the compose file and the gateway.

**PostgREST logs "connection refused" to the database.**
It cannot reach PostgreSQL. Confirm the database is listening (`pg_isready -h 127.0.0.1 -p 5432`)
and that `PGRST_DB_URI` points at it.

**Buttons do nothing / the login form doesn't submit when opened from another device or IP.**
Next's dev server blocks requests to `/_next/*` that carry an `Origin` from a host it does not
know, so the page's JavaScript never loads and nothing is interactive. Add the host you open the
app from to `allowedDevOrigins` in `next.config.ts` (top level, not under `experimental`) and
restart the dev server:

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.1.9", "100.111.174.126"],
  // ...
};
```

Do not add a separate `next.config.js` alongside `next.config.ts` — Next only loads one config.

**Login appears to succeed but you bounce straight back to the login page.**
The session cookie is marked `Secure` when `NODE_ENV=production`, and browsers drop `Secure`
cookies over plain HTTP on a non-localhost address. `npm run dev` forces
`NODE_ENV=development`, which avoids this. If you start the server another way, unset
`NODE_ENV` first.

**Next prints "non-standard NODE_ENV value".**
Something exported `NODE_ENV` (often an IDE terminal). `npm run dev` now forces
`NODE_ENV=development`, so you should not see this; if you do, run `unset NODE_ENV` first.

**`npm run build` complains about `NODE_ENV`.**
Never run `next build` with a hand-set `NODE_ENV`; leave it to the script.

---

## Limitations of the local Docker setup

These are inherent to not running a full Supabase stack, not bugs:

* **Live updates do not work.** The `postgres_changes` subscriptions are a Supabase
  Realtime feature that PostgREST does not provide. A few pages poll as a fallback
  (e.g. the waiting rooms); the rest will not refresh on their own.
* **PDF upload fails.** Category documents are stored in a Supabase Storage bucket
  (`category-docs`), which plain Postgres does not have.
* **Google OAuth is disabled** in this mode; admin auth is email + password.

If you need those, use a hosted Supabase project instead (below).

---

## Option B: no Postgres installed

`docker-compose.yml` has an optional database container for machines without a native
PostgreSQL. It publishes `5433` on the host so it can never collide with one on `5432`:

```bash
docker compose --profile docker-db up -d db postgrest
```

Then point both layers at it in `.env.local`:

```ini
DATABASE_URL="postgres://event_suite:event_suite@127.0.0.1:5433/ringflow"
```

and start PostgREST with the matching URI:

```bash
PGRST_DB_URI=postgres://event_suite:event_suite@127.0.0.1:5433/ringflow docker compose up -d postgrest
npm run db:push && npm run db:seed
```

---

## Appendix: using hosted Supabase instead

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema: open the SQL Editor and run `supabase/master.sql` (or apply
   `supabase/migrations/*.sql` in order).
3. In `.env.local`, replace `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY` with your project's values, and set `DATABASE_URL`
   to your project's Postgres connection string.
4. You no longer need the gateway or the local containers.
5. To sign in as an admin, insert your user into the allow-list:

```sql
INSERT INTO public.admins (id, email)
VALUES ('YOUR_USER_UUID', 'your.email@example.com');
```
