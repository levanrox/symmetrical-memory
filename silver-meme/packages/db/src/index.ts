export { uuidv7 } from './ids';
export { clearAll, migrate, resetDatabase } from './migrate';
export { MIGRATIONS, type Migration } from './migrations';
export { createPool, databaseUrl, DEFAULT_DATABASE_URL, TEST_DATABASE_URL } from './pool';
export { createDb, schema, type DbClient } from './drizzle';
export { toDateString, toNumberOrNull } from './rowutil';
export type { Pool } from 'pg';

export {
  createAthlete,
  createOrganization,
  createUser,
  findAthleteByPublicCode,
  findUserByEmail,
  listAthletes,
  listOrganizations,
  type Athlete,
  type Organization,
  type User,
} from './repositories/registry';

export {
  createCategory,
  createEvent,
  createRegistration,
  createTatami,
  getCategory,
  getEvent,
  listCategories,
  listEvents,
  listParticipantsForCategory,
  listRegistrations,
  listTatamis,
  setCategoryState,
  type Category,
  type EventRecord,
  type Registration,
  type Tatami,
} from './repositories/event';

export {
  assignCategoryToTatami,
  getDraw,
  getDrawGraph,
  isDrawLocked,
  listAssignmentsForEvent,
  listAssignmentsForTatami,
  listCategoryIdsForTatami,
  lockDraw,
  saveDraw,
  type Assignment,
  type DrawRecord,
} from './repositories/draw';

export {
  appendMatchEvent,
  getMatch,
  listDevices,
  listMatchEvents,
  listMatchesForCategory,
  setMatchStatus,
  upsertDevice,
  writeAudit,
  type DeviceRecord,
  type MatchEventRecord,
  type MatchSlotRecord,
  type MatchWithSlots,
} from './repositories/runtime';
