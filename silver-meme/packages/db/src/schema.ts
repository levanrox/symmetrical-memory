import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => organizations.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('EVENT_ADMIN'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const athletes = pgTable('athletes', {
  id: uuid('id').primaryKey(),
  publicCode: text('public_code')
    .notNull()
    .unique()
    .default(sql`'KA-' || lpad(nextval('athlete_code_seq')::text, 6, '0')`),
  displayName: text('display_name').notNull(),
  dateOfBirth: date('date_of_birth', { mode: 'string' }),
  gender: text('gender'),
  organizationId: uuid('organization_id').references(() => organizations.id),
  clubName: text('club_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  venue: text('venue'),
  startsOn: date('starts_on', { mode: 'string' }),
  endsOn: date('ends_on', { mode: 'string' }),
  rulesetId: text('ruleset_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const tatamis = pgTable(
  'tatamis',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
  },
  (table) => [unique().on(table.eventId, table.number)],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ageGroup: text('age_group').notNull(),
  gender: text('gender').notNull(),
  discipline: text('discipline').notNull().default('KUMITE'),
  minWeightKg: numeric('min_weight_kg', { precision: 5, scale: 1 }),
  maxWeightKg: numeric('max_weight_kg', { precision: 5, scale: 1 }),
  state: text('state').notNull().default('CREATED'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    clubName: text('club_name'),
    seed: integer('seed'),
    status: text('status').notNull().default('APPROVED'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.categoryId, table.athleteId)],
);

export const draws = pgTable('draws', {
  id: uuid('id').primaryKey(),
  categoryId: uuid('category_id')
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  format: text('format').notNull(),
  rulesetId: text('ruleset_id').notNull(),
  tournamentSize: integer('tournament_size').notNull(),
  byeCount: integer('bye_count').notNull(),
  checksum: text('checksum').notNull(),
  state: text('state').notNull().default('DRAFT'),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const drawVersions = pgTable(
  'draw_versions',
  {
    id: uuid('id').primaryKey(),
    drawId: uuid('draw_id')
      .notNull()
      .references(() => draws.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    graph: jsonb('graph').notNull(),
    checksum: text('checksum').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.drawId, table.version)],
);

export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    matchNo: integer('match_no').notNull(),
    roundNo: integer('round_no').notNull(),
    roundName: text('round_name').notNull(),
    bracketType: text('bracket_type').notNull(),
    status: text('status').notNull().default('SCHEDULED'),
  },
  (table) => [unique().on(table.categoryId, table.matchNo)],
);

export const matchSlots = pgTable(
  'match_slots',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    slotType: text('slot_type').notNull(),
    registrationId: uuid('registration_id').references(() => registrations.id, { onDelete: 'set null' }),
    sourceMatchId: text('source_match_id').references((): AnyPgColumn => matches.id, { onDelete: 'cascade' }),
  },
  (table) => [unique().on(table.matchId, table.position)],
);

export const tatamiAssignments = pgTable('tatami_assignments', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  tatamiId: uuid('tatami_id')
    .notNull()
    .references(() => tatamis.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
});

export const matchEvents = pgTable(
  'match_events',
  {
    id: uuid('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actor: text('actor'),
    deviceId: text('device_id'),
    commandId: text('command_id'),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.matchId, table.seq),
    uniqueIndex('match_events_command_id')
      .on(table.commandId)
      .where(sql`command_id IS NOT NULL`),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    tatamiId: uuid('tatami_id').references(() => tatamis.id, { onDelete: 'set null' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [unique().on(table.eventId, table.name)],
);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  actor: text('actor'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  detail: jsonb('detail').notNull().default({}),
  ts: timestamp('ts', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
