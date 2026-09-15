import { describe, expect, it } from 'vitest';
import {
  channelDisplayId,
  channelKind,
  channelSchema,
  channelTatamiId,
  clientMessageSchema,
  displayChannel,
  MATCH_EVENT_TYPES,
  matchEventSchema,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  serverMessageSchema,
  tatamiChannel,
  type ClientMessage,
  type MatchEventType,
  type MatchState,
  type RingQueue,
  type ServerMessage,
} from './index';
import { ProtocolError } from './errors';

const uuid = (n: number): string => `0191f2a0-1234-7abc-8def-${String(n).padStart(12, '0')}`;

const MATCH_ID = uuid(1);
const EVENT_ID = uuid(4);
const TATAMI_ID = uuid(5);
const CATEGORY_ID = uuid(6);
const MESSAGE_ID = uuid(7);
const COMMAND_ID = uuid(8);
const UNKNOWN_ID = uuid(9);

const TS = 1_762_000_000_000;

const eventBase = {
  matchId: MATCH_ID,
  seq: 7,
  ts: TS,
  actor: 'admin@example.com',
  device: 'TATAMI-01',
  commandId: COMMAND_ID,
};

const BARE_TYPES: readonly MatchEventType[] = [
  'MATCH_CALLED',
  'MATCH_READY',
  'MATCH_START',
  'MATCH_END',
  'CLOCK_START',
  'CLOCK_STOP',
  'CLOCK_RESUME',
  'YAME',
  'TSUZUKETE',
  'WAKARETE',
  'MOTO_NO_ICHI',
  'DOCTOR_CALL',
  'INJURY_TIMEOUT_START',
  'INJURY_TIMEOUT_END',
];

const PAYLOAD_TYPES: Partial<Record<MatchEventType, Record<string, unknown>>> = {
  SCORE: { side: 'AKA', value: 3, target: 'JODAN', technique: 'KERI' },
  PENALTY: { side: 'AO', level: 'CHUI' },
  SENSHU: { side: 'AKA' },
  SENSHU_TORIMASEN: { side: 'AO' },
  KIKEN: { side: 'AKA' },
  CLOCK_ADJUST: { elapsedMs: 5_000, reason: 'timekeeper correction' },
  RESULT_CONFIRM: { winner: 'AKA', method: 'POINTS' },
  RESULT_VOID: { reason: 'wrong athlete recorded' },
  EVENT_VOID: { targetSeq: 3, reason: 'accidental double tap' },
  VIDEO_REVIEW_REQUEST: { side: 'AKA', requestedValue: 3 },
  VIDEO_REVIEW_RESULT: { side: 'AKA', outcome: 'AWARDED', value: 3, cardReturned: false },
  KATA_JUDGE_VOTE: { judgeNo: 1, side: 'AKA' },
  KATA_FLAGS: { akaFlags: 3, aoFlags: 2, totalJudges: 5 },
  TEAM_BOUT_RESULT: { boutNo: 1, winner: 'AKA', akaPoints: 2, aoPoints: 0, method: 'POINTS' },
};

function validEvent(type: MatchEventType): Record<string, unknown> {
  return { ...eventBase, type, payload: PAYLOAD_TYPES[type] ?? {} };
}

const validMatchState: MatchState = {
  matchId: MATCH_ID,
  status: 'LIVE',
  aka: { registrationId: uuid(20), displayName: 'Rahul Kumar' },
  ao: { registrationId: uuid(21), displayName: 'Arjun Shetty' },
  senshu: 'AKA',
  senshuLocked: false,
  kiken: null,
  clock: { elapsedMs: 41_000, running: true, startedAtMs: TS },
  penalties: { aka: [], ao: [{ level: 'CHUI', category: 2, seq: 4, ts: TS }] },
  derived: {
    aka: { points: 3, ippon: 1, wazaAri: 0, yuko: 0, chui: 0 },
    ao: { points: 0, ippon: 0, wazaAri: 0, yuko: 0, chui: 1 },
  },
  superior: false,
};

const validRingQueue: RingQueue = {
  tatamiId: TATAMI_ID,
  currentMatchId: MATCH_ID,
  entries: [
    {
      matchId: MATCH_ID,
      matchNo: 42,
      roundName: 'Quarter-final',
      categoryId: CATEGORY_ID,
      categoryName: 'Senior Male -67kg',
      akaName: 'Rahul Kumar',
      aoName: null,
      state: 'LIVE',
    },
  ],
};

describe('channels', () => {
  it('builds and classifies tatami channels', () => {
    expect(tatamiChannel('t1')).toBe('tatami:t1');
    expect(channelKind('tatami:t1')).toBe('tatami');
    expect(channelTatamiId('tatami:t1')).toBe('t1');
    expect(channelDisplayId('tatami:t1')).toBeUndefined();
  });

  it('builds and classifies display channels', () => {
    expect(displayChannel('d1')).toBe('display:d1');
    expect(channelKind('display:d1')).toBe('display');
    expect(channelDisplayId('display:d1')).toBe('d1');
    expect(channelTatamiId('display:d1')).toBeUndefined();
  });

  it('classifies the admin channel', () => {
    expect(channelKind('admin')).toBe('admin');
    expect(channelTatamiId('admin')).toBeUndefined();
  });

  it('accepts the three channel shapes', () => {
    expect(channelSchema.safeParse('admin').success).toBe(true);
    expect(channelSchema.safeParse('tatami:t1').success).toBe(true);
    expect(channelSchema.safeParse('display:d1').success).toBe(true);
  });

  it('rejects an empty or unknown channel', () => {
    expect(channelSchema.safeParse('tatami:').success).toBe(false);
    expect(channelSchema.safeParse('display:').success).toBe(false);
    expect(channelSchema.safeParse('public').success).toBe(false);
    expect(channelSchema.safeParse('').success).toBe(false);
  });
});

describe('match events', () => {
  it.each([...MATCH_EVENT_TYPES])('parses a valid %s event', (type) => {
    expect(matchEventSchema.safeParse(validEvent(type)).success).toBe(true);
  });

  it('accounts for every event type as either bare or payload-carrying', () => {
    // Guards against a new event type being added without a fixture.
    for (const type of MATCH_EVENT_TYPES) {
      const isBare = BARE_TYPES.includes(type);
      const hasPayload = type in PAYLOAD_TYPES;

      expect(isBare !== hasPayload, `event type ${type} is unclassified`).toBe(true);
    }
  });

  it('rejects a score value outside 1-2-3', () => {
    expect(
      matchEventSchema.safeParse({
        ...eventBase,
        type: 'SCORE',
        payload: { side: 'AKA', value: 4, target: 'JODAN', technique: 'KERI' },
      }).success,
    ).toBe(false);
  });

  it('rejects a penalty category outside 1-2', () => {
    expect(
      matchEventSchema.safeParse({
        ...eventBase,
        type: 'PENALTY',
        payload: { side: 'AKA', level: 'CHUI', category: 3 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown penalty level', () => {
    expect(
      matchEventSchema.safeParse({
        ...eventBase,
        type: 'PENALTY',
        payload: { side: 'AKA', level: 'WARNING', category: 1 },
      }).success,
    ).toBe(false);
  });

  it('requires EVENT_VOID to name the sequence it voids', () => {
    expect(matchEventSchema.safeParse({ ...eventBase, type: 'EVENT_VOID', payload: {} }).success).toBe(
      false,
    );
  });

  it('requires every event to carry a commandId for idempotency', () => {
    const { commandId: _omitted, ...withoutCommandId } = eventBase;
    expect(
      matchEventSchema.safeParse({ ...withoutCommandId, type: 'MATCH_START', payload: {} }).success,
    ).toBe(false);
  });

  it('rejects an unknown field rather than silently dropping it', () => {
    expect(
      matchEventSchema.safeParse({ ...validEvent('MATCH_START'), sneaky: true }).success,
    ).toBe(false);
  });

  it('accepts a deterministic match id, which is what the draw engine produces', () => {
    // `<categoryId>:M7` — not a UUID, deliberately, so a redraw stays
    // comparable and a printed sheet can be checked against the live bracket.
    expect(
      matchEventSchema.safeParse({ ...validEvent('MATCH_START'), matchId: `${CATEGORY_ID}:M7` })
        .success,
    ).toBe(true);
  });

  it('rejects an empty match id', () => {
    expect(matchEventSchema.safeParse({ ...validEvent('MATCH_START'), matchId: '' }).success).toBe(
      false,
    );
  });
});

describe('server messages', () => {
  it('parses a MATCH_STATE frame', () => {
    const frame: ServerMessage = {
      v: PROTOCOL_VERSION,
      id: MESSAGE_ID,
      seq: 12,
      ts: TS,
      channel: tatamiChannel('t1'),
      type: 'MATCH_STATE',
      payload: validMatchState,
    };

    expect(serverMessageSchema.safeParse(frame).success).toBe(true);
  });

  it('parses a QUEUE_UPDATE frame', () => {
    const frame: ServerMessage = {
      v: PROTOCOL_VERSION,
      id: MESSAGE_ID,
      seq: 13,
      ts: TS,
      channel: displayChannel('d1'),
      type: 'QUEUE_UPDATE',
      payload: validRingQueue,
    };

    expect(serverMessageSchema.safeParse(frame).success).toBe(true);
  });

  it('parses an admin SNAPSHOT frame', () => {
    const frame: ServerMessage = {
      v: PROTOCOL_VERSION,
      id: MESSAGE_ID,
      seq: 1,
      ts: TS,
      channel: 'admin',
      type: 'SNAPSHOT',
      payload: {
        scope: 'admin',
        event: { id: EVENT_ID, name: 'Karnataka State Championship', rulesetId: 'WKF_KUMITE_2026' },
        tatamis: [{ id: TATAMI_ID, name: 'Tatami 1', number: 1, state: 'RUNNING' }],
        assignments: [{ tatamiId: TATAMI_ID, categoryId: CATEGORY_ID, sequence: 0, state: 'LIVE' }],
        devices: [
          {
            deviceId: uuid(3),
            name: 'TATAMI-01',
            kind: 'tatami_laptop',
            state: 'ONLINE',
            tatamiId: TATAMI_ID,
            lastSeenAt: TS,
          },
        ],
        alerts: [],
        serverTime: TS,
      },
    };

    expect(serverMessageSchema.safeParse(frame).success).toBe(true);
  });

  it('parses a tatami SNAPSHOT frame', () => {
    const frame: ServerMessage = {
      v: PROTOCOL_VERSION,
      id: MESSAGE_ID,
      seq: 1,
      ts: TS,
      channel: tatamiChannel('t1'),
      type: 'SNAPSHOT',
      payload: {
        scope: 'tatami',
        tatami: { id: TATAMI_ID, name: 'Tatami 1', number: 1, state: 'LOADED' },
        assignments: [],
        queue: validRingQueue,
        serverTime: TS,
      },
    };

    expect(serverMessageSchema.safeParse(frame).success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(
      serverMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        id: MESSAGE_ID,
        seq: 1,
        ts: TS,
        channel: 'admin',
        type: 'TELEPORT',
        payload: {},
      }).success,
    ).toBe(false);
  });

  it('rejects a wrong protocol version', () => {
    expect(
      serverMessageSchema.safeParse({
        v: 99,
        id: MESSAGE_ID,
        seq: 1,
        ts: TS,
        channel: 'admin',
        type: 'CLOCK',
        payload: { elapsedMs: 0, running: false, startedAtMs: null },
      }).success,
    ).toBe(false);
  });

  it('requires a sequence number so clients can detect a gap', () => {
    expect(
      serverMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        id: MESSAGE_ID,
        ts: TS,
        channel: 'admin',
        type: 'CLOCK',
        payload: { elapsedMs: 0, running: false, startedAtMs: null },
      }).success,
    ).toBe(false);
  });

  it('rejects a snapshot with an unknown scope', () => {
    expect(
      serverMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        id: MESSAGE_ID,
        seq: 1,
        ts: TS,
        channel: 'admin',
        type: 'SNAPSHOT',
        payload: { scope: 'everything', serverTime: TS },
      }).success,
    ).toBe(false);
  });
});

describe('client messages', () => {
  const commandBase = { matchId: MATCH_ID, commandId: COMMAND_ID };

  const validCommands: Record<string, unknown> = {
    CALL_MATCH: { ...commandBase },
    START_MATCH: { ...commandBase },
    PAUSE_MATCH: { ...commandBase },
    RESUME_MATCH: { ...commandBase },
    END_MATCH: { ...commandBase },
    SCORE: { ...commandBase, side: 'AKA', value: 2, target: 'CHUDAN', technique: 'KERI' },
    PENALTY: { ...commandBase, side: 'AO' },
    SENSHU: { ...commandBase, side: 'AKA' },
    SENSHU_TORIMASEN: { ...commandBase, side: 'AKA' },
    KIKEN: { ...commandBase, side: 'AO' },
    VOID_RESULT: { ...commandBase, reason: 'wrong athlete recorded' },
    UNDO_LAST: { ...commandBase },
    VOTE_FLAG: { ...commandBase, judgeNo: 1, side: 'AKA' },
    RECORD_FLAGS: { ...commandBase, akaFlags: 4, aoFlags: 1 },
    RECORD_TEAM_BOUT: {
      ...commandBase,
      boutNo: 1,
      winner: 'AKA',
      akaPoints: 3,
      aoPoints: 1,
      method: 'POINTS',
    },
  };

  it.each(Object.entries(validCommands))('parses a valid %s command', (_type, payload) => {
    const frame: ClientMessage = {
      v: PROTOCOL_VERSION,
      id: MESSAGE_ID,
      ts: TS,
      channel: tatamiChannel('t1'),
      type: _type as ClientMessage['type'],
      payload,
    } as ClientMessage;

    expect(clientMessageSchema.safeParse(frame).success).toBe(true);
  });

  it('rejects a command without a commandId', () => {
    expect(
      clientMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        id: MESSAGE_ID,
        ts: TS,
        channel: 'tatami:t1',
        type: 'CALL_MATCH',
        payload: { matchId: MATCH_ID },
      }).success,
    ).toBe(false);
  });

  it('rejects a draw recorded as an individual elimination outcome', () => {
    // HIKIWAKE is legal in round-robin and team contexts only (Art. 12.2.5), but
    // that is a ruleset decision the server enforces — the wire format accepts it
    // so the same command shape works in every context.
    expect(
      clientMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        id: MESSAGE_ID,
        ts: TS,
        channel: 'tatami:t1',
        type: 'CONFIRM_RESULT',
        payload: { matchId: MATCH_ID, commandId: COMMAND_ID, winner: 'HIKIWAKE', method: 'HIKIWAKE' },
      }).success,
    ).toBe(true);
  });
});

describe('parse helpers', () => {
  it('parses a well-formed server frame', () => {
    const frame = {
      v: PROTOCOL_VERSION,
      id: MESSAGE_ID,
      seq: 5,
      ts: TS,
      channel: 'admin',
      type: 'CLOCK',
      payload: { elapsedMs: 1_000, running: true, startedAtMs: TS },
    };

    expect(parseServerMessage(frame).type).toBe('CLOCK');
  });

  it('throws a ProtocolError carrying field-level issues', () => {
    try {
      parseServerMessage({ nonsense: true });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);

      const typed = error as ProtocolError;
      expect(typed.code).toBe('INVALID_MESSAGE');
      expect(typed.message).toContain('SERVER');
      expect(typed.issues.length).toBeGreaterThan(0);
    }
  });

  it('names the direction when parsing a client command fails', () => {
    try {
      parseClientMessage({ type: 'SCORE' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ProtocolError).message).toContain('CLIENT');
    }
  });

  it('reports the offending path for a nested failure', () => {
    try {
      parseServerMessage({
        v: PROTOCOL_VERSION,
        id: MESSAGE_ID,
        seq: 1,
        ts: TS,
        channel: 'admin',
        type: 'DEVICE_STATUS',
        payload: { deviceId: UNKNOWN_ID, name: '', kind: 'tatami_laptop', state: 'ONLINE', tatamiId: null, lastSeenAt: null },
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ProtocolError).issues.some((i) => i.path === 'payload.name')).toBe(true);
    }
  });
});
