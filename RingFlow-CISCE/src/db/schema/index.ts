import { sql, relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// =========================================================================
// 1. Core RingFlow Tables
// =========================================================================

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  eventDate: date('event_date', { mode: 'string' }),
  venue: text('venue'),
  city: text('city'),
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'completed'
  organiserCode: text('organiser_code'),
  stagerCodes: jsonb('stager_codes').default([]),
  showPublicDraws: boolean('show_public_draws').default(true),
  showPublicScoreboard: boolean('show_public_scoreboard').notNull().default(false),
  // 0 = no bronze bout, 1 = single bronze, 2 = repechage with two bronzes (WKF).
  defaultBronzeMedals: integer('default_bronze_medals').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const rings = pgTable(
  'rings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ringOrder: integer('ring_order').notNull(),
    accessCode: text('access_code').notNull(),
    timerStatus: text('timer_status').notNull().default('idle'),
    timerStartedAt: timestamp('timer_started_at', { withTimezone: true, mode: 'date' }),
    timerPausedAt: timestamp('timer_paused_at', { withTimezone: true, mode: 'date' }),
    timerAccumulatedSeconds: integer('timer_accumulated_seconds').notNull().default(0),
    // Authoritative match clock (millisecond precision).
    // timer_started_at = real UTC instant the CURRENT run segment began.
    // timer_accumulated_ms = elapsed ms accumulated BEFORE that segment.
    timerDurationMs: integer('timer_duration_ms').notNull().default(180000),
    timerAccumulatedMs: integer('timer_accumulated_ms').notNull().default(0),
    sidesSwapped: boolean('sides_swapped').notNull().default(false),
    currentMatchId: text('current_match_id'),
    matchDurationSeconds: integer('match_duration_seconds').notNull().default(180),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.tournamentId, table.name)]
);

// =========================================================================
// 1b. CSV/Excel Import Batches (P6 imports: categories + athletes)
// =========================================================================
// Every committed import writes one import_batches row. Each row it created
// or updated gets an import_batch_items record carrying a before-image
// (null for created rows) and an after-image, so a whole batch can be
// rolled back with one click.

export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'categories' | 'athletes'
  filename: text('filename'),
  rowCounts: jsonb('row_counts')
    .notNull()
    .default({ created: 0, updated: 0, skipped: 0, errors: 0 }),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true, mode: 'date' }),
});

export const importBatchItems = pgTable(
  'import_batch_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(), // 'category' | 'athlete' | 'category_entry'
    entityId: uuid('entity_id').notNull(),
    // Full row JSON before the import touched it (null when the row was created).
    before: jsonb('before'),
    // Full row JSON after the import wrote it.
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.batchId, table.entity, table.entityId)]
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ageBracket: text('age_bracket'),
  weightClass: text('weight_class'),
  athletesCount: integer('athletes_count').notNull().default(0),
  expectedMatches: integer('expected_matches').notNull().default(0),
  hasFullRoster: boolean('has_full_roster').notNull().default(false),
  belt: text('belt'),
  ageMin: integer('age_min'),
  ageMax: integer('age_max'),
  sex: text('sex'),
  day: text('day'),
  docUrl: text('doc_url'),
  // Short organiser-facing alias used by CSV imports to match athlete rows
  // to this category (e.g. "KU12M"). Optional, unique per tournament.
  code: text('code'),
  // Null means "inherit the tournament's default".
  bronzeMedals: integer('bronze_medals'),
  // Kata draw configuration (P2). Nulls mean "use the WKF default":
  // kata_format null -> 'SINGLE_ELIM_REPECHAGE',
  // kata_advance_per_group null -> 2, kata_ranking_method null -> 'WKF_VICTORY_POINTS'.
  // kata_group_size is an explicit override: target athletes per group, which
  // replaces the WKF 3.7.9 group-count table (groupCount = ceil(n / kata_group_size)).
  kataFormat: text('kata_format'),
  kataGroupSize: integer('kata_group_size'),
  kataAdvancePerGroup: integer('kata_advance_per_group'),
  kataRankingMethod: text('kata_ranking_method'),
  // Kata judge panel size (P3). Null = default: 7 when the kata format
  // involves round-robin groups, else 5 (see resolvePanelSize).
  kataPanelSize: integer('kata_panel_size'),
  importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const athletes = pgTable('athletes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  categoryId: uuid('category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  tournamentId: uuid('tournament_id').references(() => tournaments.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull(),
  chestNumber: text('chest_number'),
  belt: text('belt'),
  age: text('age'),
  sex: text('sex'),
  day: text('day'),
  dojo: text('dojo'),
  school: text('school'),
  schoolCode: text('school_code'),
  sportsId: text('sports_id'),
  weight: numeric('weight', { precision: 5, scale: 2 }),
  importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const categoryAssignments = pgTable(
  'category_assignments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ringId: uuid('ring_id')
      .notNull()
      .references(() => rings.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    queueOrder: integer('queue_order').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'paused' | 'completed'
    matchesCompleted: integer('matches_completed').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    pausedAt: timestamp('paused_at', { withTimezone: true, mode: 'date' }),
    totalPausedSeconds: integer('total_paused_seconds').notNull().default(0),
    stagerStatus: text('stager_status'),
    stagerName: text('stager_name'),
    stagerActionAt: timestamp('stager_action_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.ringId, table.queueOrder),
    unique().on(table.categoryId),
  ]
);

export const moderatorRequests = pgTable('moderator_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ringId: uuid('ring_id')
    .notNull()
    .references(() => rings.id, { onDelete: 'cascade' }),
  accessCodeUsed: text('access_code_used').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked'
  sessionToken: uuid('session_token').unique(),
  deviceInfo: jsonb('device_info').default({}),
  moderatorName: text('moderator_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
});

export const organiserRequests = pgTable('organiser_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  accessCodeUsed: text('access_code_used').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked'
  sessionToken: uuid('session_token').unique(),
  deviceInfo: jsonb('device_info').default({}),
  organiserName: text('organiser_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const stagerRequests = pgTable('stager_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  accessCodeUsed: text('access_code_used').notNull(),
  status: text('status').notNull().default('pending'),
  sessionToken: uuid('session_token').unique(),
  deviceInfo: jsonb('device_info').default({}),
  stagerName: text('stager_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const eventLog = pgTable('event_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  ringId: uuid('ring_id')
    .notNull()
    .references(() => rings.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  moderatorSessionId: uuid('moderator_session_id'),
  action: text('action').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

// =========================================================================
// 2. Decoupled Registration & Category Setup (Official & Festival Support)
// =========================================================================

export const tournamentCategoryDefinitions = pgTable('tournament_category_definitions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  categoryName: text('category_name').notNull(),
  eventType: text('event_type').notNull(), // 'kumite' | 'kata' | 'team_kumite' | 'team_kata'
  gender: text('gender').notNull(), // 'M' | 'F' | 'any'
  minAge: integer('min_age'),
  maxAge: integer('max_age'),
  minWeight: numeric('min_weight', { precision: 5, scale: 2 }),
  maxWeight: numeric('max_weight', { precision: 5, scale: 2 }),
  rules: jsonb('rules').default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const tournamentRegistrations = pgTable(
  'tournament_registrations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    weight: numeric('weight', { precision: 5, scale: 2 }),
    kata: boolean('kata').notNull().default(false),
    kumite: boolean('kumite').notNull().default(false),
    teamKata: boolean('team_kata').notNull().default(false),
    teamKumite: boolean('team_kumite').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.tournamentId, table.athleteId)]
);

export const categoryEntries = pgTable(
  'category_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    registrationId: uuid('registration_id').references(
      () => tournamentRegistrations.id,
      { onDelete: 'cascade' }
    ),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    seed: integer('seed'),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.categoryId, table.athleteId)]
);

// =========================================================================
// 3. Tournament Draws & Match Execution (Silver-Meme Integration)
// =========================================================================

export const draws = pgTable('draws', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  categoryId: uuid('category_id')
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  format: text('format').notNull().default('SINGLE_ELIMINATION'),
  rulesetId: text('ruleset_id').notNull().default('WKF_KUMITE_2026'),
  tournamentSize: integer('tournament_size').notNull(),
  byeCount: integer('bye_count').notNull().default(0),
  checksum: text('checksum').notNull(),
  state: text('state').notNull().default('DRAFT'), // 'DRAFT' | 'LOCKED'
  // What this draw was actually generated with, so it can be re-read honestly.
  bronzeMedals: integer('bronze_medals').notNull().default(2),
  // Kata group-stage snapshot (P2): group membership plus the format config the
  // draw was generated with, so the "fill elimination bracket from group
  // results" phase can rebuild advancers without re-deriving anything.
  // Shape: { format, rankingMethod, advancePerGroup, randomSeed,
  //          groups: [{ id, name, memberIds: string[] }] }. Null for non-kata
  // or single-elimination draws.
  kataGroups: jsonb('kata_groups'),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const drawVersions = pgTable(
  'draw_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    drawId: uuid('draw_id')
      .notNull()
      .references(() => draws.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    graph: jsonb('graph').notNull(),
    checksum: text('checksum').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.drawId, table.version)]
);

export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(), // formatted as e.g. "catId-m1"
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    matchNo: integer('match_no').notNull(),
    roundNo: integer('round_no').notNull(),
    roundName: text('round_name').notNull(),
    bracketType: text('bracket_type').notNull().default('MAIN'), // 'MAIN' | 'REPECHAGE' | 'BRONZE' | 'POOL'
    // Kata group-stage bouts carry the group they belong to (e.g. the pool id
    // from the draw graph); null for ordinary bracket bouts.
    groupId: text('group_id'),
    status: text('status').notNull().default('SCHEDULED'), // 'SCHEDULED' | 'READY' | 'LIVE' | 'COMPLETED' | 'CONFIRMED' | 'BYE'
    winnerId: uuid('winner_id').references(() => athletes.id, { onDelete: 'set null' }),
    akaScore: integer('aka_score').notNull().default(0),
    aoScore: integer('ao_score').notNull().default(0),
    akaPenalties: integer('aka_penalties').notNull().default(0),
    aoPenalties: integer('ao_penalties').notNull().default(0),
    senshu: text('senshu'),
    winnerSide: text('winner_side'),
    decisionMethod: text('decision_method'),
    // Kata choice per side (P3): official WKF kata numbers (1-102) announced
    // for this bout. Set by the moderator before/at bout time; null until set.
    akaKataNumber: integer('aka_kata_number'),
    aoKataNumber: integer('ao_kata_number'),
  },
  (table) => [unique().on(table.categoryId, table.matchNo)]
);

export const matchSlots = pgTable(
  'match_slots',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // 1 for AKA, 2 for AO
    slotType: text('slot_type').notNull(), // 'ENTRY' | 'WINNER_OF' | 'LOSER_OF' | 'BYE'
    athleteId: uuid('athlete_id').references(() => athletes.id, { onDelete: 'set null' }),
    sourceMatchId: text('source_match_id').references((): AnyPgColumn => matches.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [unique().on(table.matchId, table.position)]
);

export const matchEvents = pgTable(
  'match_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actor: text('actor'),
    deviceId: text('device_id'),
    commandId: text('command_id'),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.matchId, table.seq)]
);

// =========================================================================
// 3b. Kata Judge Scoring (P3)
// =========================================================================
// Judges are numbered SEATS, not identities. A judge scans a QR / enters a
// 6-char join code, gives a display name, and lands in `judge_requests` as
// pending; the moderator approves (assigning the lowest free seat and issuing
// the session token) or rejects. The token travels only in an httpOnly
// cookie and is never serialized into a response body (C1 lesson).

export const judgeJoinCodes = pgTable('judge_join_codes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ringId: uuid('ring_id')
    .notNull()
    .references(() => rings.id, { onDelete: 'cascade' }),
  // CSPRNG, 6 chars from an unambiguous alphabet (no 0/O/1/I/L).
  code: text('code').notNull().unique(),
  createdBy: text('created_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const judgeRequests = pgTable(
  'judge_requests',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ringId: uuid('ring_id')
      .notNull()
      .references(() => rings.id, { onDelete: 'cascade' }),
    joinCodeUsed: text('join_code_used').notNull(),
    judgeName: text('judge_name').notNull(),
    // Assigned on approval: the lowest free seat (1-based).
    seatNumber: integer('seat_number'),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked'
    // Live credential: set ONLY on approval, cleared on revoke. NEVER
    // serialize this column into a response (see serializeJudgeRequest).
    sessionToken: uuid('session_token').unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('judge_requests_ring_status_idx').on(table.ringId, table.status)]
);

export const kataScores = pgTable(
  'kata_scores',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    judgeRequestId: uuid('judge_request_id')
      .notNull()
      .references(() => judgeRequests.id, { onDelete: 'cascade' }),
    seatNumber: integer('seat_number').notNull(),
    side: text('side').notNull(), // 'AKA' | 'AO'
    // Integer tenths (50-100) so 0.1-step arithmetic stays exact.
    scoreTenths: integer('score_tenths').notNull(),
    // True when entered by the moderator (empty seat, or a correction of a
    // judge's score); false for scores submitted by a judge's own device.
    isManual: boolean('is_manual').notNull().default(false),
    // Client idempotency key: a retry with the same key returns the original
    // row instead of writing twice. NULL for plain upserts.
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.matchId, table.judgeRequestId, table.side)]
);

// Derived group standings for kata group stages (P3). DESIGN DECISION:
// standings are computed per group bout-result and stored here — NOT by
// mutating `draws.kata_groups`, which is the immutable draw-input snapshot
// (members + config at draw time). Rewriting the snapshot on every bout would
// destroy draw history; this table is cheap to upsert per group and trivially
// queryable by the tally UI. standings is RankedKataAthlete[] (see P2).
export const kataGroupStandings = pgTable(
  'kata_group_standings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    standings: jsonb('standings').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.categoryId, table.groupId)]
);

// =========================================================================
// 4. Relational Mappings
// =========================================================================

export const tournamentsRelations = relations(tournaments, ({ one, many }) => ({
  admin: one(admins, { fields: [tournaments.adminId], references: [admins.id] }),
  rings: many(rings),
  categories: many(categories),
  athletes: many(athletes),
  categoryDefinitions: many(tournamentCategoryDefinitions),
  registrations: many(tournamentRegistrations),
}));

export const importBatchesRelations = relations(importBatches, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [importBatches.tournamentId], references: [tournaments.id] }),
  items: many(importBatchItems),
}));

export const importBatchItemsRelations = relations(importBatchItems, ({ one }) => ({
  batch: one(importBatches, { fields: [importBatchItems.batchId], references: [importBatches.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [categories.tournamentId], references: [tournaments.id] }),
  entries: many(categoryEntries),
  draw: one(draws, { fields: [categories.id], references: [draws.categoryId] }),
  matches: many(matches),
  assignment: one(categoryAssignments, { fields: [categories.id], references: [categoryAssignments.categoryId] }),
}));

export const athletesRelations = relations(athletes, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [athletes.tournamentId], references: [tournaments.id] }),
  category: one(categories, { fields: [athletes.categoryId], references: [categories.id] }),
  registrations: many(tournamentRegistrations),
  categoryEntries: many(categoryEntries),
}));

export const categoryEntriesRelations = relations(categoryEntries, ({ one }) => ({
  category: one(categories, { fields: [categoryEntries.categoryId], references: [categories.id] }),
  registration: one(tournamentRegistrations, { fields: [categoryEntries.registrationId], references: [tournamentRegistrations.id] }),
  athlete: one(athletes, { fields: [categoryEntries.athleteId], references: [athletes.id] }),
}));

export const drawsRelations = relations(draws, ({ one, many }) => ({
  category: one(categories, { fields: [draws.categoryId], references: [categories.id] }),
  versions: many(drawVersions),
}));

export const ringsRelations = relations(rings, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [rings.tournamentId], references: [tournaments.id] }),
  assignments: many(categoryAssignments),
  moderatorRequests: many(moderatorRequests),
  judgeJoinCodes: many(judgeJoinCodes),
  judgeRequests: many(judgeRequests),
}));

export const judgeJoinCodesRelations = relations(judgeJoinCodes, ({ one }) => ({
  ring: one(rings, { fields: [judgeJoinCodes.ringId], references: [rings.id] }),
}));

export const judgeRequestsRelations = relations(judgeRequests, ({ one, many }) => ({
  ring: one(rings, { fields: [judgeRequests.ringId], references: [rings.id] }),
  scores: many(kataScores),
}));

export const kataScoresRelations = relations(kataScores, ({ one }) => ({
  match: one(matches, { fields: [kataScores.matchId], references: [matches.id] }),
  judgeRequest: one(judgeRequests, { fields: [kataScores.judgeRequestId], references: [judgeRequests.id] }),
}));

export const kataGroupStandingsRelations = relations(kataGroupStandings, ({ one }) => ({
  category: one(categories, { fields: [kataGroupStandings.categoryId], references: [categories.id] }),
}));

export const categoryAssignmentsRelations = relations(categoryAssignments, ({ one }) => ({
  ring: one(rings, { fields: [categoryAssignments.ringId], references: [rings.id] }),
  category: one(categories, { fields: [categoryAssignments.categoryId], references: [categories.id] }),
}));

export const tournamentCategoryDefinitionsRelations = relations(tournamentCategoryDefinitions, ({ one }) => ({
  tournament: one(tournaments, { fields: [tournamentCategoryDefinitions.tournamentId], references: [tournaments.id] }),
}));

export const tournamentRegistrationsRelations = relations(tournamentRegistrations, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [tournamentRegistrations.tournamentId], references: [tournaments.id] }),
  athlete: one(athletes, { fields: [tournamentRegistrations.athleteId], references: [athletes.id] }),
  entries: many(categoryEntries),
}));

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  tournament: one(tournaments, { fields: [eventLog.tournamentId], references: [tournaments.id] }),
  ring: one(rings, { fields: [eventLog.ringId], references: [rings.id] }),
  category: one(categories, { fields: [eventLog.categoryId], references: [categories.id] }),
}));


// =========================================================================
// 5. App Settings (PHASE P7a)
// =========================================================================

/**
 * Generic key/value store for operator-configurable app settings (e.g.
 * `judge_base_url`, the public tunnel URL the admin pastes into Settings).
 * Written via src/lib/judgeAccess.ts get/set helpers; JUDGE_BASE_URL env
 * var still wins over the DB value so ops can override without the UI.
 *
 * NOTE: table added without `drizzle-kit generate` (P7a scope) — run
 * `npm run db:push` (or the project's migrate job) to materialise it.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});
