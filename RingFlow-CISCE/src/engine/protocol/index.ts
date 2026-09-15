export {
  ADMIN_CHANNEL,
  channelDisplayId,
  channelKind,
  channelSchema,
  channelTatamiId,
  DISPLAY_PREFIX,
  displayChannel,
  TATAMI_PREFIX,
  tatamiChannel,
  type Channel,
  type ChannelKind,
} from './channels';

export { ProtocolError, type ProtocolIssue } from './errors';

/**
 * The rules vocabulary this contract is built from, re-exported so consumers
 * (the scoring reducer, the consoles) can import the wire types and the words
 * they are made of from one place.
 */
export type {
  AgeGroup,
  CompetitionContext,
  CompetitionFormat,
  DecisionMethod,
  PenaltyLevel,
  ScoreType,
  Side,
  Target,
  Technique,
} from '@event-suite/rules-engine';

export {
  clockStateSchema,
  decisionMethodSchema,
  MATCH_EVENT_TYPES,
  matchEventSchema,
  matchIdSchema,
  matchStateSchema,
  outcomeSideSchema,
  penaltyLevelSchema,
  penaltyRecordSchema,
  scoreTallySchema,
  scoreValueSchema,
  sideSchema,
  tallyFor,
  targetSchema,
  techniqueSchema,
  type AthleteScore,
  type ClockState,
  type MatchEvent,
  type MatchEventType,
  type MatchState,
  type OutcomeSide,
  type PenaltyRecord,
  type ScoreTally,
  type ScoreValue,
} from './match';

export {
  alertSeveritySchema,
  adminAlertSchema,
  assignmentSchema,
  channelSnapshotSchema,
  deviceKindSchema,
  deviceStatusSchema,
  eventRefSchema,
  queuedMatchSchema,
  ringQueueSchema,
  tatamiRefSchema,
  type AdminAlert,
  type AlertSeverity,
  type Assignment,
  type ChannelSnapshot,
  type DeviceKind,
  type DeviceStatus,
  type EventRef,
  type QueuedMatch,
  type RingQueue,
  type SnapshotScope,
  type TatamiRef,
} from './snapshot';

export {
  clientMessageSchema,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientMessage,
  type ClientMessageType,
  type ServerMessage,
  type ServerMessageType,
} from './messages';
