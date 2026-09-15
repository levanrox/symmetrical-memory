import { appendMatchEvent, setMatchStatus, uuidv7, type Pool } from '@event-suite/db';
import {
  clientMessageSchema,
  type ClientMessage,
  type MatchEventType,
  type PenaltyLevel,
} from '@event-suite/protocol';
import { nextPenaltyLevel } from '@event-suite/scoring';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, Public, type AuthenticatedUser } from './auth';

import { CompetitionService, type MatchView } from './competition';
import { DATABASE_POOL } from './database';
import { RealtimeHub, adminChannel, displayChannelFor, tatamiChannelFor } from './realtime';

export interface TatamiJudgeSlot {
  judgeNo: number;
  deviceId: string;
  lastSeen: number;
}

const tatamiJudgeSlots = new Map<string, Map<string, TatamiJudgeSlot>>();

interface MappedEvent {
  type: MatchEventType;
  payload: Record<string, unknown>;
}

/**
 * What the server resolved before translating a command.
 *
 * Both of these are things the operator must not be asked to supply: the next
 * rung of a penalty ladder, and which event an undo should void.
 */
interface CommandContext {
  penaltyLevel: PenaltyLevel | null;
  undo: { seq: number; label: string } | null;
}

/**
 * Translates a client command into the event it appends.
 *
 * The command vocabulary is deliberately narrower than the event vocabulary: an
 * operator can call, start, score, penalise, undo and confirm, but cannot invent
 * a `CLOCK_ADJUST` or pick a penalty level from the console (§9 permissions).
 */
function mapCommand(message: ClientMessage, context: CommandContext): MappedEvent {
  switch (message.type) {
    case 'CALL_MATCH':
      return { type: 'MATCH_CALLED', payload: {} };

    case 'START_MATCH':
      return { type: 'MATCH_START', payload: {} };

    // Pausing stops the clock; the bout stays live.
    case 'PAUSE_MATCH':
      return { type: 'CLOCK_STOP', payload: {} };

    case 'RESUME_MATCH':
      return { type: 'CLOCK_RESUME', payload: {} };

    case 'SCORE':
      return {
        type: 'SCORE',
        payload: {
          side: message.payload.side,
          value: message.payload.value,
          target: message.payload.target,
          technique: message.payload.technique,
        },
      };

    case 'PENALTY':
      // The level is not the operator's to choose. It is the next rung of this
      // athlete's ladder, resolved against the ruleset by the server.
      if (context.penaltyLevel === null) {
        throw new ConflictException('this match has no ruleset, so no penalty ladder to apply');
      }
      return { type: 'PENALTY', payload: { side: message.payload.side, level: context.penaltyLevel } };

    case 'SENSHU':
      return { type: 'SENSHU', payload: { side: message.payload.side } };

    case 'SENSHU_TORIMASEN':
      return { type: 'SENSHU_TORIMASEN', payload: { side: message.payload.side } };

    case 'END_MATCH':
      return { type: 'MATCH_END', payload: {} };

    case 'KIKEN':
      return { type: 'KIKEN', payload: { side: message.payload.side } };

    case 'CONFIRM_RESULT':
      return {
        type: 'RESULT_CONFIRM',
        payload: { winner: message.payload.winner, method: message.payload.method },
      };

    case 'VOTE_FLAG':
      return {
        type: 'KATA_JUDGE_VOTE',
        payload: {
          judgeNo: message.payload.judgeNo,
          side: message.payload.side,
          akaScore: message.payload.akaScore,
          aoScore: message.payload.aoScore,
        },
      };

    case 'RECORD_FLAGS':
      return {
        type: 'KATA_FLAGS',
        payload: { akaFlags: message.payload.akaFlags, aoFlags: message.payload.aoFlags },
      };

    case 'RECORD_TEAM_BOUT':
      return {
        type: 'TEAM_BOUT_RESULT',
        payload: {
          boutNo: message.payload.boutNo,
          winner: message.payload.winner,
          akaPoints: message.payload.akaPoints,
          aoPoints: message.payload.aoPoints,
          method: message.payload.method,
        },
      };

    case 'VOID_RESULT':
      return { type: 'RESULT_VOID', payload: { reason: message.payload.reason } };

    case 'UNDO_LAST':
      if (context.undo === null) {
        throw new ConflictException('there is nothing left to undo in this match');
      }
      return {
        type: 'EVENT_VOID',
        payload: { targetSeq: context.undo.seq, reason: `undo ${context.undo.label}` },
      };

    default: {
      const exhaustive: never = message;
      throw new BadRequestException(`unsupported command ${JSON.stringify(exhaustive)}`);
    }
  }
}


@Controller()
export class MatchesController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly competition: CompetitionService,
    private readonly hub: RealtimeHub,
  ) {}

  @Get('matches/:id')
  async match(@Param('id') id: string) {
    const view = await this.competition.matchView(id);

    if (view === null) {
      throw new NotFoundException(`unknown match "${id}"`);
    }

    return view;
  }

  @Get('tatamis/:id/queue')
  async queue(@Param('id') tatamiId: string) {
    const queue = await this.competition.ringQueue(tatamiId);

    if (queue === null) {
      throw new NotFoundException('this ring has no assigned categories');
    }

    return queue;
  }

  @Get('events/:id/rings')
  async rings(@Param('id') eventId: string) {
    const tatamis = await this.competition.tatamisOf(eventId);

    const rings = [];
    for (const tatami of tatamis) {
      const queue = await this.competition.ringQueue(tatami.id);

      rings.push({
        tatami,
        assignedCount: queue?.categories.length ?? 0,
        currentMatchId: queue?.currentMatchId ?? null,
        readyCount: queue?.categories.reduce((total, view) => total + view.readyMatchIds.length, 0) ?? 0,
        completed: queue?.categories.filter((view) => view.podium !== null).length ?? 0,
      });
    }

    return rings;
  }

  /**
   * Applies one scoring command to a match.
   *
   * Idempotent by `commandId`: a retried or double-tapped command returns the
   * original event and changes nothing, which is what keeps a dropped Wi-Fi
   * packet from becoming a phantom point (§8).
   */
  @Post('matches/:id/commands')
  async command(
    @Param('id') matchId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = clientMessageSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '<body>'}: ${issue.message}`),
      );
    }

    const message = parsed.data;

    if (message.payload.matchId !== matchId) {
      throw new BadRequestException('the matchId in the body does not match the URL');
    }

    const before = await this.competition.requireMatchView(matchId);

    // Resolved before translation: the penalty ladder lives in the ruleset, and
    // the undo target lives in the event log. Neither belongs to the console.
    const ruleset = await this.competition.rulesetForMatch(matchId);

    const context: CommandContext = {
      penaltyLevel:
        message.type === 'PENALTY' && ruleset !== null
          ? nextPenaltyLevel(before.state, message.payload.side, ruleset)
          : null,
      undo: message.type === 'UNDO_LAST' ? before.undoable : null,
    };

    const mapped = mapCommand(message, context);

    const { event, duplicate } = await appendMatchEvent(this.pool, {
      matchId,
      type: mapped.type,
      payload: mapped.payload,
      actor: user.email,
      commandId: message.payload.commandId,
    });

    if (!duplicate) {
      if (mapped.type === 'MATCH_START') {
        await setMatchStatus(this.pool, matchId, 'LIVE');
      }
      if (mapped.type === 'MATCH_END') {
        await setMatchStatus(this.pool, matchId, 'FINISHED');
      }
      if (mapped.type === 'RESULT_CONFIRM') {
        await setMatchStatus(this.pool, matchId, 'CONFIRMED');
      }
      if (mapped.type === 'RESULT_VOID') {
        // Reopen so the corrected result can be entered.
        await setMatchStatus(this.pool, matchId, 'READY');
      }
    }

    const after = await this.competition.requireMatchView(matchId);
    await this.publish(after, before);

    return { duplicate, event, match: after };
  }

  /**
   * Public endpoint for judge devices / mobile phones that scanned a QR code.
   * Records that judge's red/blue flag vote in real time.
   */
  /**
   * Public endpoint for judge devices / mobile phones that scanned a QR code.
   * Records that judge's red/blue flag vote or numeric Kata scores (5.0-10.0) in real time.
   */
  @Public()
  @Post('matches/:id/judge-vote')
  async judgeVote(
    @Param('id') matchId: string,
    @Body()
    body: {
      judgeNo: number;
      side?: 'AKA' | 'AO';
      akaScore?: number;
      aoScore?: number;
      commandId?: string;
    },
  ) {
    let side = body.side;
    if (!side && body.akaScore !== undefined && body.aoScore !== undefined) {
      side = body.akaScore >= body.aoScore ? 'AKA' : 'AO';
    }

    if (!body.judgeNo || (side !== 'AKA' && side !== 'AO')) {
      throw new BadRequestException(
        'Valid judgeNo (1-7) and side (AKA or AO) or numeric scores (5.0-10.0) are required',
      );
    }

    const before = await this.competition.requireMatchView(matchId);
    const commandId = body.commandId ?? uuidv7();

    const { event, duplicate } = await appendMatchEvent(this.pool, {
      matchId,
      type: 'KATA_JUDGE_VOTE',
      payload: {
        judgeNo: Number(body.judgeNo),
        side,
        ...(body.akaScore !== undefined ? { akaScore: body.akaScore } : {}),
        ...(body.aoScore !== undefined ? { aoScore: body.aoScore } : {}),
      },
      actor: `judge-${body.judgeNo}`,
      commandId,
    });

    const after = await this.competition.requireMatchView(matchId);
    await this.publish(after, before);

    return { duplicate, event, match: after };
  }

  /**
   * Single QR code enrollment endpoint:
   * First person to scan becomes Judge 1, second becomes Judge 2, etc.
   */
  @Public()
  @Post('tatamis/:id/judges/claim')
  async claimJudge(
    @Param('id') tatamiId: string,
    @Body() body: { deviceId: string; preferredJudgeNo?: number },
  ) {
    if (!body?.deviceId) {
      throw new BadRequestException('deviceId is required');
    }

    let tatamiMap = tatamiJudgeSlots.get(tatamiId);
    if (!tatamiMap) {
      tatamiMap = new Map();
      tatamiJudgeSlots.set(tatamiId, tatamiMap);
    }

    // Check if device already has a slot
    const existing = tatamiMap.get(body.deviceId);
    if (existing) {
      if (
        body.preferredJudgeNo &&
        body.preferredJudgeNo !== existing.judgeNo &&
        body.preferredJudgeNo >= 1 &&
        body.preferredJudgeNo <= 7
      ) {
        const taken = Array.from(tatamiMap.values()).some(
          (s) => s.judgeNo === body.preferredJudgeNo && s.deviceId !== body.deviceId,
        );
        if (!taken) {
          existing.judgeNo = body.preferredJudgeNo;
        }
      }
      existing.lastSeen = Date.now();
      const slots = Array.from(tatamiMap.values());
      this.hub.broadcast(tatamiChannelFor(tatamiId), 'DEVICE_STATUS', {
        deviceId: body.deviceId,
        role: 'JUDGE',
        status: 'ONLINE',
        tatamiId,
        lastSeenAt: Date.now(),
      });
      return { judgeNo: existing.judgeNo, slots };
    }

    // Find taken judge numbers
    const takenNos = new Set(Array.from(tatamiMap.values()).map((s) => s.judgeNo));

    let assigned = 1;
    if (
      body.preferredJudgeNo &&
      !takenNos.has(body.preferredJudgeNo) &&
      body.preferredJudgeNo >= 1 &&
      body.preferredJudgeNo <= 7
    ) {
      assigned = body.preferredJudgeNo;
    } else {
      for (let i = 1; i <= 7; i++) {
        if (!takenNos.has(i)) {
          assigned = i;
          break;
        }
      }
    }

    const slot: TatamiJudgeSlot = {
      judgeNo: assigned,
      deviceId: body.deviceId,
      lastSeen: Date.now(),
    };
    tatamiMap.set(body.deviceId, slot);

    const slots = Array.from(tatamiMap.values());
    this.hub.broadcast(tatamiChannelFor(tatamiId), 'DEVICE_STATUS', {
      deviceId: body.deviceId,
      role: 'JUDGE',
      status: 'ONLINE',
      tatamiId,
      lastSeenAt: Date.now(),
    });
    return { judgeNo: assigned, slots };
  }

  @Public()
  @Get('tatamis/:id/judges')
  async getJudges(@Param('id') tatamiId: string) {
    const tatamiMap = tatamiJudgeSlots.get(tatamiId) ?? new Map();
    return { slots: Array.from(tatamiMap.values()) };
  }

  @Public()
  @Post('tatamis/:id/judges/release')
  async releaseJudge(
    @Param('id') tatamiId: string,
    @Body() body: { deviceId?: string; judgeNo?: number },
  ) {
    const tatamiMap = tatamiJudgeSlots.get(tatamiId);
    if (tatamiMap) {
      if (body.deviceId) {
        tatamiMap.delete(body.deviceId);
      } else if (body.judgeNo) {
        for (const [devId, slot] of tatamiMap.entries()) {
          if (slot.judgeNo === body.judgeNo) {
            tatamiMap.delete(devId);
          }
        }
      }
      this.hub.broadcast(tatamiChannelFor(tatamiId), 'DEVICE_STATUS', {
        deviceId: body.deviceId ?? 'system',
        role: 'JUDGE',
        status: 'OFFLINE',
        tatamiId,
        lastSeenAt: Date.now(),
      });
    }
    return { ok: true };
  }

  @Public()
  @Post('tatamis/:id/judges/reset')
  async resetJudges(@Param('id') tatamiId: string) {
    tatamiJudgeSlots.delete(tatamiId);
    this.hub.broadcast(tatamiChannelFor(tatamiId), 'DEVICE_STATUS', {
      deviceId: 'system',
      role: 'JUDGE',
      status: 'OFFLINE',
      tatamiId,
      lastSeenAt: Date.now(),
    });
    return { ok: true };
  }


  /** Pushes the new state to the ring, its displays, and the control room. */
  private async publish(after: MatchView, before: MatchView | null): Promise<void> {
    const tatamiId = await this.tatamiForCategory(this.categoryOf(after.matchId));

    const channels = [adminChannel()];
    if (tatamiId !== null) {
      channels.push(tatamiChannelFor(tatamiId), displayChannelFor(tatamiId));
    }

    for (const channel of channels) {
      this.hub.broadcast(channel, 'MATCH_STATE', after.state ?? { matchId: after.matchId });
    }

    // Advancement changes the ring's queue, so send that too.
    if (tatamiId !== null && before !== null) {
      const queue = await this.competition.ringQueue(tatamiId);
      if (queue !== null) {
        this.hub.broadcast(tatamiChannelFor(tatamiId), 'QUEUE_UPDATE', queue);
        this.hub.broadcast(displayChannelFor(tatamiId), 'QUEUE_UPDATE', queue);
      }
      this.hub.broadcast(adminChannel(), 'QUEUE_UPDATE', { tatamiId });
    }
  }

  private categoryOf(matchId: string): string {
    // Deterministic ids are "<categoryId>:M<no>", so the category is a prefix.
    const separator = matchId.lastIndexOf(':M');
    return separator === -1 ? matchId : matchId.slice(0, separator);
  }

  private async tatamiForCategory(categoryId: string): Promise<string | null> {
    const result = await this.pool.query<{ tatami_id: string }>(
      'SELECT tatami_id FROM tatami_assignments WHERE category_id = $1',
      [categoryId],
    );

    return result.rows[0]?.tatami_id ?? null;
  }
}
