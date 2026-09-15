import { z } from 'zod';
import { CATEGORY_STATES, DEVICE_STATES, MATCH_STATES, TATAMI_STATES } from '@event-suite/domain';
import { matchIdSchema } from './match';

/**
 * Snapshot and status payloads (blueprint §8).
 *
 * A client that connects — or reconnects — receives one full SNAPSHOT and then
 * deltas. That is what lets a tatami recover from a browser crash without a
 * page reload, so the snapshot must be complete for its scope and nothing more.
 */

export const deviceKindSchema = z.enum([
  'tatami_laptop',
  'tatami_tablet',
  'scoreboard',
  'display',
  'announcer',
]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

export const deviceStatusSchema = z.strictObject({
  deviceId: z.uuid(),
  name: z.string().min(1),
  kind: deviceKindSchema,
  state: z.enum(DEVICE_STATES),
  tatamiId: z.uuid().nullable(),
  lastSeenAt: z.int().nonnegative().nullable(),
});
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

/** One match as the operator sees it in a ring queue. */
export const queuedMatchSchema = z.strictObject({
  matchId: matchIdSchema,
  matchNo: z.int().nonnegative(),
  roundName: z.string().min(1),
  categoryId: z.uuid(),
  categoryName: z.string().min(1),
  akaName: z.string().nullable(),
  aoName: z.string().nullable(),
  state: z.enum(MATCH_STATES),
});
export type QueuedMatch = z.infer<typeof queuedMatchSchema>;

export const ringQueueSchema = z.strictObject({
  tatamiId: z.uuid(),
  currentMatchId: matchIdSchema.nullable(),
  entries: z.array(queuedMatchSchema),
});
export type RingQueue = z.infer<typeof ringQueueSchema>;

export const alertSeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

export const adminAlertSchema = z.strictObject({
  id: z.uuid(),
  severity: alertSeveritySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  tatamiId: z.uuid().nullable(),
  matchId: matchIdSchema.nullable(),
  ts: z.int().nonnegative(),
});
export type AdminAlert = z.infer<typeof adminAlertSchema>;

/** A locked category placed on a ring, in running order (blueprint §3 step 6). */
export const assignmentSchema = z.strictObject({
  tatamiId: z.uuid(),
  categoryId: z.uuid(),
  /** Order within the ring's day. */
  sequence: z.int().nonnegative(),
  state: z.enum(CATEGORY_STATES),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const tatamiRefSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  number: z.int().positive(),
  state: z.enum(TATAMI_STATES),
});
export type TatamiRef = z.infer<typeof tatamiRefSchema>;

export const eventRefSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  rulesetId: z.string().min(1),
});
export type EventRef = z.infer<typeof eventRefSchema>;

/**
 * Discriminated by `scope`, so a client can only be handed the view it is
 * entitled to. A tatami snapshot deliberately carries no data for other rings.
 *
 * Note: the per-category draw payload is added in Phase 3, once the draw-engine
 * types exist. It is omitted here rather than approximated.
 */
export const channelSnapshotSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('admin'),
    event: eventRefSchema,
    tatamis: z.array(tatamiRefSchema),
    assignments: z.array(assignmentSchema),
    devices: z.array(deviceStatusSchema),
    alerts: z.array(adminAlertSchema),
    serverTime: z.int().nonnegative(),
  }),
  z.strictObject({
    scope: z.literal('tatami'),
    tatami: tatamiRefSchema,
    assignments: z.array(assignmentSchema),
    queue: ringQueueSchema,
    serverTime: z.int().nonnegative(),
  }),
  z.strictObject({
    scope: z.literal('display'),
    tatami: tatamiRefSchema,
    queue: ringQueueSchema,
    serverTime: z.int().nonnegative(),
  }),
]);
export type ChannelSnapshot = z.infer<typeof channelSnapshotSchema>;
export type SnapshotScope = ChannelSnapshot['scope'];
