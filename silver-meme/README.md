# Event Suite

Draw, ring operations and scoring for local karate tournaments — built for a venue LAN that may
have no internet at all.

An admin imports entries, generates and locks a draw, and assigns categories to rings. Each ring
runs its matches from a browser, a scoreboard displays the live score, and the bracket advances
itself as results are confirmed.

---

## What works today

| Area | State |
|---|---|
| Draw generation — single elimination, seeding, bye distribution, club separation, versioning, lock | Done |
| Advancement — winner/loser/bye resolution, walkovers, podium | Done |
| Repechage — two bronze medals by default, one if the organiser asks for one | Done |
| Scoring — kumite events, clock, penalties, SENSHU, decision logic, undo by voiding, result reversal | Done |
| Rules — `WKF_KUMITE_2026` transcribed from the rulebook with Article references | Done |
| Server — REST + WebSocket, deny-by-default auth, idempotent commands, preflight health check | Done |
| Admin console — events, rings, categories, entry import, draws, ring assignment | Done |
| Ring console — queue, call, clock, scoring pad, result confirmation and reversal | Done |
| Scoreboard — crowd-facing live display | Done |
| Post-event results — podiums, club medal table, CSV export, printable page | Done |
| Backup — `pg_dump` script with retention; restore verified against a fresh database | Done |
| Docker Compose — Postgres with the role and all three databases created on first boot | Done |
| Round-robin and pools | **Not built** — the engine refuses these formats rather than producing something wrong |
| Kata, team kumite | Not built (the ruleset and match model allow for them) |
| QR check-in | Not built — needs HTTPS on the venue LAN |
| Certificates | Not built — results export as CSV and print from the browser instead |
| Excel import with column mapping | Not built — entries are pasted or typed instead |

---

## Requirements

- Node.js 22 or newer
- pnpm 9 (`corepack enable pnpm`, or `npm i -g pnpm@9`)
- PostgreSQL 16 — easiest via the Docker Compose file in this repo

---

## Quickstart

```bash
# 1. Database
cp .env.example .env
docker compose up -d db          # starts Postgres, creates the role and databases

# 2. Dependencies
pnpm install

# 3. Build the workspace
pnpm -w build

# 4. Seed a runnable demo tournament (optional but recommended)
pnpm seed                        # admin@example.com / karate-admin

# 5. Run the server and the web app together
pnpm dev
```

Then open:

| Surface | URL |
|---|---|
| Admin console | http://localhost:3000/admin |
| Ring console | http://localhost:3000/ring/&lt;tatamiId&gt; (the admin console links to it) |
| Scoreboard | http://localhost:3000/scoreboard/&lt;tatamiId&gt; |
| Server preflight | http://localhost:4000/api/status |

Not using Docker? Create the role and databases by hand and skip step 1:

```bash
sudo -u postgres psql -f infra/local-db-setup.sql
```

If your user is not in the `docker` group, prefix the compose commands with `sudo`:

```bash
sudo usermod -aG docker "$USER"    # then log out and back in, once
```

---

## Running a tournament

1. **Sign in** at `/` and create the first operator (that route closes once one exists).
2. **Create an event**, then add one or more **rings**.
3. **Add a category** (name, age group, gender).
4. **Paste the entries** — one per line, `Name, Club`. Two columns copied straight out of Excel
   work too, because a tab is accepted as a separator.
5. **Generate the draw.** Choose **two bronze medals** (the WKF default, with a repechage line per
   finalist) or **one** (the two line winners meet for a single bronze) before generating. The
   choice is part of the draw, not something applied afterwards. Warnings are shown, not hidden: a
   club clash that cannot be separated, or a category that is too small, is reported rather than
   silently drawn.
6. **Lock it.** After a lock the draw is immutable; regenerating it is refused.
7. **Assign it to a ring.** Only locked draws can be assigned.
8. **Open the ring console** and run the matches: *Call to tatami* → *Start bout* → score →
   *End bout* → confirm the result. The bracket, including the repechage, advances on
   confirmation and the next match becomes ready.
9. **Open the scoreboard** on a second screen so the hall can see it.

Every command is idempotent, so a double-tap or a dropped Wi-Fi packet cannot score twice.

### While a bout is running

- **Penalties are one button, not three.** Tapping *Penalty* records the next rung of that
  athlete's own ladder — WKF Art. 10.2-10.3 fixes the sequence at CHUI, CHUI, CHUI, HANSOKU CHUI,
  HANSOKU — and the button names what the next tap will be. Ladders are per athlete: AKA on a
  third CHUI says nothing about AO. The level is resolved server-side, so the console cannot
  record a fourth CHUI or jump straight to disqualification.
- **SENSHU can be withdrawn, not only awarded.** When an athlete holds the advantage the control
  becomes *Withdraw senshu*, mirroring the referee's own announcement (Art. 12.2.8). It applies when
  the advantage is forfeited for avoiding combat late in the bout (Art. 10.4.16) or when a video
  review shows the opponent also scored, so the point was not unopposed (Art. 12.2.9). Withdraw it
  inside the last 15 seconds and neither athlete can be awarded SENSHU again (Art. 12.2.10), so the
  award control disables itself and says why.
- **Undo takes back the last scoring action**, naming it ("Undo AKA ippon"). The event is voided
  rather than deleted, so the record of the mis-tap survives in the log and the derived state —
  scores, penalties, SENSHU, the proposed outcome — recomputes itself.
- **Reversing a confirmed result** is a separate, deliberate action, because it moves the whole
  bracket.
- **The clock** is owned by the server and interpolated in the browser between readings, so it
  counts down smoothly and cannot be thrown off by the two machines' clocks disagreeing.

---

## After the event

Open **results** from the admin console, or go straight to `/results/<eventId>`. It shows every
podium and a club medal table, derived from the same resolution the live bracket used — so a
printed result cannot disagree with what the hall saw.

- **Print** from the browser for a paper copy.
- **Download CSV** for the federation or for next season's records.

```bash
curl -H "authorization: Bearer $TOKEN" \
  http://localhost:4000/api/events/$EVENT_ID/results.csv
```

Podiums and the medal table are derived from the same resolution the live bracket used, so a
printed result cannot disagree with what the hall saw.

---

## Backing up during an event

One box is one failure domain, so back the database up while the tournament is running:

```bash
./infra/backup.sh /media/usb/event-backups
```

It writes a timestamped `pg_dump` and keeps the newest 48. From cron, every ten minutes:

```cron
*/10 * * * * /path/to/infra/backup.sh /media/usb/event-backups >> /var/log/event-backup.log 2>&1
```

Restoring onto a spare laptop is what turns "the server died" into "we lost twenty minutes":

```bash
createdb -O event_suite event_suite
pg_restore --no-owner --dbname postgres://event_suite:event_suite@127.0.0.1:5432/event_suite \
  /media/usb/event-backups/event-suite-20260914-143000.dump
```

**Practise this before the event, and time it.** The number you get is the number you plan around.

---

## Repository layout

```
apps/
  web/                     Next.js — /admin, /ring, /scoreboard
services/
  event-server/            NestJS — REST + WebSocket, auth, scoring commands
packages/
  domain/                  Category / match / tatami / device state machines
  rules-engine/            Versioned rulesets; WKF_KUMITE_2026 with Article references
  draw-engine/             Pure bracket generation and resolution (no I/O)
  scoring/                 Event log → match state; the Art. 12.2 decision logic
  protocol/                Wire contracts (zod): channels, events, messages, snapshots
  db/                      Raw SQL over `pg`, migrations, repositories
infra/
  local-db-setup.sql       Role, databases and the two settings that matter
docker-compose.yml         Postgres for development and the venue box
```

**Why no ORM:** the schema is small and the queries are simple, so `pg` plus plain SQL is one
fewer build step and one fewer abstraction. See `packages/db/src/migrations.ts`.

### Two things worth knowing before changing code

**Draw and scoring are separate, and coupled through exactly two contracts.** The draw engine
never knows about scoring, and the runtime never generates brackets. They meet at the `DrawGraph`
and at `packages/protocol`.

**Scoring is event-sourced.** A score is an appended event (`SCORE`, `AKA`, `3`), never a mutated
column. Current state is a pure reduction over the log, which is what makes undo possible at all:
voiding an event and reducing again *is* the undo mechanism, and the original stays in the log for
a dispute.

---

## Rules

`packages/rules-engine/src/rulesets/wkf-kumite-2026.ts` is a transcription of the WKF Kumite
Competition Rules 2026, with the Article cited on every value — bout durations (Art. 5.1), score
values (Art. 8.6), the eight-point margin (Art. 7.7), the CHUI → HANSOKU CHUI → HANSOKU ladder
(Art. 10), the tie-break order (Art. 12.2.3–4) and the scorekeeper symbols (Art. 12.6).

Local variations are meant to be *data*, not code. Art. 17.1 permits national federations to
modify these rules for non-WKF events, and Art. 5.2 permits shortened bouts, so:

```ts
const local = createDerivedRuleset(getRuleset('WKF_KUMITE_2026'), {
  id: 'KARNATAKA_KUMITE_LOCAL_V1',
  version: '1.0',
  durationSeconds: { senior: 120, cadet: 90 },
});
```

No Karnataka ruleset ships yet, on purpose: its age and weight structure needs verifying against
the state association's own documentation first, and a guessed ruleset silently produces wrong
draws.

**The repechage is implemented, and it still wants a referee's eye.** The shape is the one the
blueprint specified: each finalist carries a line holding everyone they beat, the line is a ladder
from the earliest loser up to the semifinal loser, and the top of each ladder takes a bronze. It is
covered by tests that assert exact medallists for 3, 4, 8, 16 and 32 entrants, and that a bye
cascades through a rung instead of stranding it.

What has *not* happened is validation by a practising WKF referee. Before this awards a real medal,
have one check the ladder — particularly that a semifinal loser needs one win for bronze while an
earlier loser needs more. If their answer differs, `packages/draw-engine/src/repechage.ts` is the
only file that changes.

---

## Testing

```bash
pnpm -w test        # 351 tests
pnpm verify         # lint + typecheck + build + test
```

The suites are not all unit tests:

- `packages/draw-engine` — golden fixtures, property tests (for any N, a bracket has N−1 matches,
  every entrant appears once, the champion is reachable from the final), determinism and
  idempotency.
- `packages/db` — integration tests against a real PostgreSQL.
- `services/event-server` — boots the actual application and runs a whole category over HTTP:
  entries → draw → lock → assign → every match → podium, plus a replayed-command test.

The database-backed suites each need their own database because the test runner executes packages
in parallel:

```bash
createdb -O event_suite event_suite_test
createdb -O event_suite event_suite_e2e
```

---

## Deploying to a venue

The whole application is designed to run from one box on a local network with no internet.

```bash
docker compose up -d db
pnpm -w build
pnpm --filter @event-suite/event-server start     # serves the API on :4000
pnpm --filter @event-suite/web start              # serves the UI on :3000
```

- Give the box a fixed address, and have the rings open `http://<box>:3000/ring/<tatamiId>`.
  The web app derives the API address from its own hostname, so nothing is baked in at build time.
- **Set `JWT_SECRET`.** The server refuses to start in production without it.
- Check `http://<box>:4000/api/status` before the first bout. It reports the database, migrations,
  free disk and clock.
- Back the database up during the event: `pg_dump` to a USB drive, and know how to restore it.
  One box is one failure domain.
- **Plain HTTP is not a secure context**, so browsers disable the camera and service workers.
  QR check-in and PWA offline mode are therefore unavailable as things stand; serving HTTPS behind
  a local certificate authority is the fix when those are wanted.

---

## Interface

The UI is a small in-house system rather than a component kit, built on Tailwind v4 with tokens
declared in `apps/web/app/globals.css`:

- **Colour carries meaning and nothing else.** Three saturated roles only: AKA red and AO blue
  (the belts) and gold for actions and medals. Everything else is a near-neutral surface.
- **AKA and AO are never distinguished by colour alone.** Both are labelled in text and shaped
  badges, on the console and on the crowd scoreboard. One in twelve men cannot reliably separate
  red from blue, and a referee, coach or spectator has to read the same bout as everyone else.
- **Scores and clocks use tabular figures** (`.tnum`) so a changing number never shifts the layout.
- **The scoring pad has tall targets** (`size="tap"`), because it is used at speed on a tablet.
- Components follow shadcn's conventions (`cn()`, `cva`, variant props) but not its default look.

---

## Development notes

- `NODE_ENV` matters. Use `NODE_ENV=development` for `pnpm install` (pnpm skips dev dependencies
  under `production`), and never for `next build` — Next's internals break with a non-standard
  value during a build.
- pnpm catalogs pin shared tool versions in `pnpm-workspace.yaml`.
- On a slow disk, commit latency dominates: one transaction with 100 inserts measured ~42 ms,
  the same 100 inserts autocommitted ~2.7 s. Batch writes.
