/**
 * Migrations, inlined as TypeScript rather than kept as `.sql` files.
 *
 * A bundler cannot carry a `migrations/` directory into `dist`, so file-based
 * migrations break the moment the package is built. Inlining removes that whole
 * class of "works in dev, not in prod" problem for the cost of one string.
 */

export interface Migration {
  id: string;
  sql: string;
}

const INIT = `
CREATE TABLE organizations (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  kind         text NOT NULL,
  parent_id    uuid REFERENCES organizations(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'EVENT_ADMIN',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE athletes (
  id              uuid PRIMARY KEY,
  public_code     text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  date_of_birth   date,
  gender          text,
  organization_id uuid REFERENCES organizations(id),
  club_name       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Athlete codes are minted by the database, not by read-max-then-insert in
-- application code: two concurrent imports would otherwise hand out the same
-- code and fail on the unique constraint.
CREATE SEQUENCE athlete_code_seq;
ALTER TABLE athletes
  ALTER COLUMN public_code
  SET DEFAULT 'KA-' || lpad(nextval('athlete_code_seq')::text, 6, '0');

CREATE TABLE events (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  venue      text,
  starts_on  date,
  ends_on    date,
  ruleset_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tatamis (
  id       uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  number   int  NOT NULL,
  name     text NOT NULL,
  UNIQUE (event_id, number)
);

CREATE TABLE categories (
  id            uuid PRIMARY KEY,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          text NOT NULL,
  age_group     text NOT NULL,
  gender        text NOT NULL,
  discipline    text NOT NULL DEFAULT 'KUMITE',
  min_weight_kg numeric(5,1),
  max_weight_kg numeric(5,1),
  state         text NOT NULL DEFAULT 'CREATED',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
  id          uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  athlete_id  uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  club_name   text,
  seed        int,
  status      text NOT NULL DEFAULT 'APPROVED',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, athlete_id)
);

CREATE TABLE draws (
  id              uuid PRIMARY KEY,
  category_id     uuid NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
  version         int  NOT NULL DEFAULT 1,
  format          text NOT NULL,
  ruleset_id      text NOT NULL,
  tournament_size int  NOT NULL,
  bye_count       int  NOT NULL,
  checksum        text NOT NULL,
  state           text NOT NULL DEFAULT 'DRAFT',
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE draw_versions (
  id         uuid PRIMARY KEY,
  draw_id    uuid NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  version    int  NOT NULL,
  graph      jsonb NOT NULL,
  checksum   text NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, version)
);

CREATE TABLE matches (
  id           text PRIMARY KEY,
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  match_no     int  NOT NULL,
  round_no     int  NOT NULL,
  round_name   text NOT NULL,
  bracket_type text NOT NULL,
  status       text NOT NULL DEFAULT 'SCHEDULED',
  UNIQUE (category_id, match_no)
);

CREATE TABLE match_slots (
  id              text PRIMARY KEY,
  match_id        text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  position        int  NOT NULL CHECK (position IN (1, 2)),
  slot_type       text NOT NULL,
  registration_id uuid REFERENCES registrations(id) ON DELETE SET NULL,
  source_match_id text REFERENCES matches(id) ON DELETE CASCADE,
  UNIQUE (match_id, position)
);

CREATE TABLE tatami_assignments (
  id          uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tatami_id   uuid NOT NULL REFERENCES tatamis(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sequence    int  NOT NULL,
  UNIQUE (category_id)
);

CREATE TABLE match_events (
  id         uuid PRIMARY KEY,
  match_id   text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq        int  NOT NULL,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor      text,
  device_id  text,
  command_id text,
  ts         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, seq)
);

CREATE UNIQUE INDEX match_events_command_id
  ON match_events (command_id)
  WHERE command_id IS NOT NULL;

CREATE TABLE devices (
  id           uuid PRIMARY KEY,
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL,
  tatami_id    uuid REFERENCES tatamis(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  UNIQUE (event_id, name)
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY,
  event_id    uuid REFERENCES events(id) ON DELETE CASCADE,
  actor       text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX registrations_category ON registrations (category_id);
CREATE INDEX matches_category ON matches (category_id);
CREATE INDEX match_slots_match ON match_slots (match_id);
CREATE INDEX match_events_match ON match_events (match_id, seq);
CREATE INDEX tatami_assignments_tatami ON tatami_assignments (tatami_id, sequence);
`;

export const MIGRATIONS: readonly Migration[] = [{ id: '001-init', sql: INIT }];
