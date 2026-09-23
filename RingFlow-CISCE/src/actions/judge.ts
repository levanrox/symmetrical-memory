"use server";

/**
 * Judge management server actions (P3) — moderator-authenticated, ring-bound.
 *
 * Every action authorizes via `authorizeJudgeRing` (moderator session for the
 * ring, else admin, else organiser — the same ladder as `authorizeBoutWrite`
 * in src/actions/matches.ts). Judge session tokens are NEVER serialized into
 * a response (C1 lesson): all selects below pick explicit fields.
 */

import { db } from "@/db";
import {
  categories,
  categoryAssignments,
  draws,
  drawVersions,
  eventLog,
  judgeJoinCodes,
  judgeRequests,
  kataGroupStandings,
  kataScores,
  matches,
  matchEvents,
  matchSlots,
  rings,
  tournaments,
} from "@/db/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ensureAdmin } from "./admin";
import { ensureOrganiser } from "./organiser";
import { validateModeratorSession } from "./moderator";
import { buildJudgeJoinUrl, getJudgeBaseUrl } from "@/lib/judgeAccess";
import { judgeRequestStatusEvent } from "@/lib/judge/judgeEvents";
import { withSeatConflictRetry } from "@/lib/judge/seatConflicts";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { isKataCategory } from "@/lib/draws/generateDraws";
import { advanceBracketAfterConfirm } from "@/lib/draws/bracketAdvance";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { isValidKataNumber } from "@/engine/rules-engine/rulesets/kata-list";
import {
  KataDecisionError,
  validateKataRepetition,
} from "@/engine/rules-engine/rulesets/kata-decision";
import {
  defaultJoinCodeExpiry,
  generateJoinCodeValue,
  lowestFreeSeat,
  resolvePanelSize,
} from "@/lib/judge/joinCodes";
import { parseKataSide, scoreToTenths } from "@/lib/judge/scores";
import {
  computeBoutDecisionFromRows,
  KATA_DECISION_METHODS,
} from "@/lib/judge/decision";
import { deriveAgeGroup, getAthleteKataHistory } from "@/lib/judge/kata";
import {
  confirmGroupBoutFollowUp,
  fillEliminationBracket,
  recomputeGroupStandings,
} from "@/lib/judge/groups";

/** Judge sessions live 24h — the event day plus teardown. */
const JUDGE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Authorize a judge-management write for a ring. Accepts, in order:
 *  1. a valid moderator session for this ring (mod_token cookie),
 *  2. a signed admin session,
 *  3. a signed organiser session.
 * Throws otherwise.
 */
async function authorizeJudgeRing(ringId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("mod_token")?.value;
    if (token) {
      const session = await validateModeratorSession(ringId, token);
      if (session) return;
    }
  } catch {}
  try {
    await ensureAdmin();
    return;
  } catch {}
  try {
    await ensureOrganiser();
    return;
  } catch {}
  throw new Error("Not authorized to manage judges for this ring");
}

/** Resolve the ring currently running a match's category (if any). */
async function ringIdForMatchLocal(matchId: string): Promise<string | null> {
  const [m] = await db
    .select({ categoryId: matches.categoryId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!m) return null;
  const [a] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.categoryId, m.categoryId),
        eq(categoryAssignments.status, "running")
      )
    )
    .limit(1);
  return a?.ringId ?? null;
}

/** Panel size from the ring's running category; 5 when there is none. */
async function panelSizeForRing(ringId: string): Promise<number> {
  const [assignment] = await db
    .select({ categoryId: categoryAssignments.categoryId })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        eq(categoryAssignments.status, "running")
      )
    )
    .limit(1);
  if (!assignment) return 5;
  const [cat] = await db
    .select({
      kataPanelSize: categories.kataPanelSize,
      kataFormat: categories.kataFormat,
    })
    .from(categories)
    .where(eq(categories.id, assignment.categoryId))
    .limit(1);
  if (!cat) return 5;
  return resolvePanelSize(cat.kataPanelSize, cat.kataFormat);
}

async function assertKataMatch(
  matchId: string
): Promise<{ id: string; categoryId: string; status: string; groupId: string | null; tournamentId: string; categoryName: string; disqualifiedSide: string | null }> {
  const [match] = await db
    .select({
      id: matches.id,
      categoryId: matches.categoryId,
      status: matches.status,
      groupId: matches.groupId,
      disqualifiedSide: matches.disqualifiedSide,
    })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match) throw new Error("Match not found");
  const [cat] = await db
    .select({
      tournamentId: categories.tournamentId,
      name: categories.name,
    })
    .from(categories)
    .where(eq(categories.id, match.categoryId))
    .limit(1);
  if (!cat) throw new Error("Category not found");
  if (!(await isKataCategory({ tournamentId: cat.tournamentId, name: cat.name }))) {
    throw new Error("This action is only for kata bouts");
  }
  return {
    id: match.id,
    categoryId: match.categoryId,
    status: match.status,
    groupId: match.groupId,
    tournamentId: cat.tournamentId,
    categoryName: cat.name,
    disqualifiedSide: match.disqualifiedSide,
  };
}

/**
 * M2: seat number -> judge_request id of the seat's currently-approved
 * occupant on a ring. The decision and the tally both filter stored marks
 * through this map, so a revoked judge's stale marks are never counted
 * against their replacement's.
 */
async function currentSeatOccupants(
  ringId: string
): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: judgeRequests.id, seatNumber: judgeRequests.seatNumber })
    .from(judgeRequests)
    .where(
      and(eq(judgeRequests.ringId, ringId), eq(judgeRequests.status, "approved"))
    );
  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.seatNumber != null) map.set(r.seatNumber, r.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Join codes
// ---------------------------------------------------------------------------

async function findActiveJoinCode(ringId: string) {
  const [code] = await db
    .select({
      id: judgeJoinCodes.id,
      code: judgeJoinCodes.code,
      expiresAt: judgeJoinCodes.expiresAt,
    })
    .from(judgeJoinCodes)
    .where(
      and(
        eq(judgeJoinCodes.ringId, ringId),
        isNull(judgeJoinCodes.revokedAt),
        sql`${judgeJoinCodes.expiresAt} > now()`
      )
    )
    .orderBy(desc(judgeJoinCodes.createdAt))
    .limit(1);
  return code ?? null;
}

async function issueJoinCode(ringId: string, createdBy?: string) {
  const [ring] = await db
    .select({ id: rings.id })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);
  if (!ring) throw new Error("Ring not found");

  // One active code per ring: revoke any existing actives first.
  await db
    .update(judgeJoinCodes)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(judgeJoinCodes.ringId, ringId), isNull(judgeJoinCodes.revokedAt))
    );

  // CSPRNG code; retry on the (astronomically unlikely) unique collision.
  let code = "";
  let issued = false;
  for (let attempt = 0; attempt < 10 && !issued; attempt += 1) {
    code = generateJoinCodeValue();
    try {
      await db.insert(judgeJoinCodes).values({
        ringId,
        code,
        createdBy: createdBy ?? null,
        expiresAt: defaultJoinCodeExpiry(),
      });
      issued = true;
    } catch (err: unknown) {
      // 23505 = unique violation (code collision): retry with a fresh code.
      if ((err as { code?: string })?.code !== "23505") throw err;
    }
  }
  if (!issued) throw new Error("Could not issue a join code; please try again");

  broadcastLiveEvent({ table: "judge_join_codes", op: "INSERT", ringId });

  return { code, url: buildJudgeJoinUrl(code, await getJudgeBaseUrl()) };
}

/** Issue (or re-issue) the ring's judge join code. Revokes any active code. */
export async function generateJoinCode(ringId: string, createdBy?: string) {
  await authorizeJudgeRing(ringId);
  return issueJoinCode(ringId, createdBy);
}

/** Regenerate the ring's judge join code (revokes the old one). */
export async function regenerateJoinCode(ringId: string, createdBy?: string) {
  await authorizeJudgeRing(ringId);
  return issueJoinCode(ringId, createdBy);
}

/** The ring's currently active join code + QR payload, or null. */
export async function getActiveJoinCode(ringId: string) {
  await authorizeJudgeRing(ringId);
  const active = await findActiveJoinCode(ringId);
  if (!active) return null;
  return {
    code: active.code,
    url: buildJudgeJoinUrl(active.code, await getJudgeBaseUrl()),
    expiresAt: active.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Judge desk state
// ---------------------------------------------------------------------------

/**
 * Everything the moderator's judge desk needs: the active join code + QR
 * URL, seats 1..panelSize with occupant names and per-side submitted flags
 * for the ring's active bout, and the pending request list.
 *
 * Explicit field selection throughout — `sessionToken` never leaves the DB.
 */
export async function getRingJudgeState(ringId: string) {
  await authorizeJudgeRing(ringId);

  const [ring] = await db
    .select({
      id: rings.id,
      name: rings.name,
      tournamentId: rings.tournamentId,
      currentMatchId: rings.currentMatchId,
    })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);
  if (!ring) throw new Error("Ring not found");

  const [tournament] = await db
    .select({ id: tournaments.id, name: tournaments.name })
    .from(tournaments)
    .where(eq(tournaments.id, ring.tournamentId))
    .limit(1);

  const panelSize = await panelSizeForRing(ringId);
  const activeCode = await findActiveJoinCode(ringId);

  const approved = await db
    .select({
      id: judgeRequests.id,
      judgeName: judgeRequests.judgeName,
      seatNumber: judgeRequests.seatNumber,
    })
    .from(judgeRequests)
    .where(
      and(eq(judgeRequests.ringId, ringId), eq(judgeRequests.status, "approved"))
    )
    .orderBy(asc(judgeRequests.seatNumber));

  const pending = await db
    .select({
      id: judgeRequests.id,
      judgeName: judgeRequests.judgeName,
      createdAt: judgeRequests.createdAt,
    })
    .from(judgeRequests)
    .where(
      and(eq(judgeRequests.ringId, ringId), eq(judgeRequests.status, "pending"))
    )
    .orderBy(asc(judgeRequests.createdAt));

  // Per-seat submitted flags for the active bout (null when no active bout).
  const submittedBySeat = new Map<number, { aka: boolean; ao: boolean }>();
  if (ring.currentMatchId) {
    const scoreRows = await db
      .select({ seatNumber: kataScores.seatNumber, side: kataScores.side })
      .from(kataScores)
      .where(eq(kataScores.matchId, ring.currentMatchId));
    for (const r of scoreRows) {
      const entry = submittedBySeat.get(r.seatNumber) ?? { aka: false, ao: false };
      if (r.side === "AKA") entry.aka = true;
      else if (r.side === "AO") entry.ao = true;
      submittedBySeat.set(r.seatNumber, entry);
    }
  }

  const seats = Array.from({ length: panelSize }, (_, i) => {
    const seatNumber = i + 1;
    const occupant = approved.find((a) => a.seatNumber === seatNumber);
    const submitted = submittedBySeat.get(seatNumber) ?? { aka: false, ao: false };
    return {
      seatNumber,
      judgeName: occupant?.judgeName ?? null,
      requestId: occupant?.id ?? null,
      submittedAka: submitted.aka,
      submittedAo: submitted.ao,
    };
  });

  return {
    ring: { id: ring.id, name: ring.name },
    tournament: tournament ? { id: tournament.id, name: tournament.name } : null,
    joinCode: activeCode
      ? {
          code: activeCode.code,
          url: buildJudgeJoinUrl(activeCode.code, await getJudgeBaseUrl()),
          expiresAt: activeCode.expiresAt.toISOString(),
        }
      : null,
    panelSize,
    activeMatchId: ring.currentMatchId,
    seats,
    pending: pending.map((p) => ({
      id: p.id,
      judgeName: p.judgeName,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

/** One approval attempt: SELECT-then-UPDATE inside a transaction. */
async function attemptApproveJudgeRequest(requestId: string, ringId: string) {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select({
        id: judgeRequests.id,
        ringId: judgeRequests.ringId,
        status: judgeRequests.status,
        judgeName: judgeRequests.judgeName,
      })
      .from(judgeRequests)
      .where(
        and(eq(judgeRequests.id, requestId), eq(judgeRequests.ringId, ringId))
      )
      .limit(1);
    if (!req) throw new Error("Judge request not found on this ring");
    if (req.status !== "pending") {
      throw new Error(`Request is already ${req.status}`);
    }

    const panelSize = await panelSizeForRing(ringId);
    const taken = await tx
      .select({ seatNumber: judgeRequests.seatNumber })
      .from(judgeRequests)
      .where(
        and(
          eq(judgeRequests.ringId, ringId),
          eq(judgeRequests.status, "approved")
        )
      );
    const seat = lowestFreeSeat(
      taken.map((t) => t.seatNumber),
      panelSize
    );
    if (seat == null) throw new Error("No free judge seats on this ring");

    const sessionToken = crypto.randomUUID();
    // P9 M-2: the partial unique index
    // judge_requests_ring_seat_approved_uniq makes a concurrent approval that
    // picked the same seat fail here with 23505 instead of silently
    // double-assigning it. withSeatConflictRetry then retries once on the
    // next free seat.
    await tx
      .update(judgeRequests)
      .set({
        status: "approved",
        seatNumber: seat,
        sessionToken,
        expiresAt: new Date(Date.now() + JUDGE_SESSION_TTL_MS),
      })
      .where(eq(judgeRequests.id, requestId));

    return { seatNumber: seat, judgeName: req.judgeName };
  });
}

/** Approve a pending judge: assigns the lowest free seat, issues the session. */
export async function approveJudgeRequest(requestId: string, ringId: string) {
  await authorizeJudgeRing(ringId);

  const result = await withSeatConflictRetry(() =>
    attemptApproveJudgeRequest(requestId, ringId),
  );

  // P9 H-2: no request id in the broadcast — it would let anyone on venue
  // WiFi harvest the id and steal the judge session via /api/judge/status.
  broadcastLiveEvent(judgeRequestStatusEvent(ringId, "approved"));

  try {
    revalidatePath(`/moderator/ring/${ringId}`);
  } catch {}
  return { success: true, ...result };
}

/** Reject a pending judge request. */
export async function rejectJudgeRequest(requestId: string, ringId: string) {
  await authorizeJudgeRing(ringId);

  const [req] = await db
    .select({ id: judgeRequests.id })
    .from(judgeRequests)
    .where(
      and(eq(judgeRequests.id, requestId), eq(judgeRequests.ringId, ringId))
    )
    .limit(1);
  if (!req) throw new Error("Judge request not found on this ring");

  await db
    .update(judgeRequests)
    .set({ status: "rejected" })
    .where(eq(judgeRequests.id, requestId));

  broadcastLiveEvent(judgeRequestStatusEvent(ringId, "rejected"));

  return { success: true };
}

/** Revoke an approved judge seat: frees the seat and kills the session. */
export async function revokeJudgeSeat(requestId: string, ringId: string) {
  await authorizeJudgeRing(ringId);

  const [req] = await db
    .select({ id: judgeRequests.id, status: judgeRequests.status })
    .from(judgeRequests)
    .where(
      and(eq(judgeRequests.id, requestId), eq(judgeRequests.ringId, ringId))
    )
    .limit(1);
  if (!req) throw new Error("Judge request not found on this ring");
  if (req.status !== "approved") {
    throw new Error(`Only an approved seat can be revoked (status: ${req.status})`);
  }

  await db
    .update(judgeRequests)
    .set({ status: "revoked", sessionToken: null, seatNumber: null })
    .where(eq(judgeRequests.id, requestId));

  broadcastLiveEvent(judgeRequestStatusEvent(ringId, "revoked"));

  return { success: true };
}

// ---------------------------------------------------------------------------
// Manual scores (moderator-entered for empty seats, or corrections)
// ---------------------------------------------------------------------------

/**
 * Moderator-entered score for one seat/side. Allowed for empty seats (a
 * placeholder seat row is created so the score stays attributable) AND to
 * correct a judge's score. Corrections are audit-logged to `event_log`.
 */
export async function submitManualScore(
  matchId: string,
  seatNumber: number,
  side: "AKA" | "AO",
  score: number
) {
  const ringId = await ringIdForMatchLocal(matchId);
  if (!ringId) throw new Error("Match is not currently assigned to a ring");
  await authorizeJudgeRing(ringId);

  const bout = await assertKataMatch(matchId);
  if (bout.status === "CONFIRMED") {
    throw new Error("Bout is already confirmed; scores can no longer be changed");
  }
  if (bout.status !== "LIVE" && bout.status !== "COMPLETED") {
    throw new Error("Scores can only be entered for a live or completed bout");
  }

  const s = parseKataSide(side);
  const tenths = scoreToTenths(score);
  const panelSize = await panelSizeForRing(ringId);
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > panelSize) {
    throw new Error(`Seat must be between 1 and ${panelSize}`);
  }

  // The seat's judge row, or a placeholder for an empty seat. The placeholder
  // has no sessionToken, so it can never authenticate as a judge.
  let [seatReq] = await db
    .select({ id: judgeRequests.id })
    .from(judgeRequests)
    .where(
      and(
        eq(judgeRequests.ringId, ringId),
        eq(judgeRequests.seatNumber, seatNumber),
        eq(judgeRequests.status, "approved")
      )
    )
    .limit(1);
  if (!seatReq) {
    // P9 M-2: the partial unique index on (ring_id, seat_number) for approved
    // rows turns a concurrent manual entry for the same empty seat into a
    // no-op here instead of a silent duplicate seat (a second 23505-free
    // read then picks up the winner's row).
    const [created] = await db
      .insert(judgeRequests)
      .values({
        ringId,
        joinCodeUsed: "MANUAL",
        judgeName: `Manual entry · Seat ${seatNumber}`,
        seatNumber,
        status: "approved",
      })
      .onConflictDoNothing()
      .returning({ id: judgeRequests.id });
    if (created) {
      seatReq = created;
    } else {
      const [winner] = await db
        .select({ id: judgeRequests.id })
        .from(judgeRequests)
        .where(
          and(
            eq(judgeRequests.ringId, ringId),
            eq(judgeRequests.seatNumber, seatNumber),
            eq(judgeRequests.status, "approved")
          )
        )
        .limit(1);
      if (!winner) throw new Error("Could not create the manual seat");
      seatReq = winner;
    }
  }

  const [prev] = await db
    .select({ id: kataScores.id, scoreTenths: kataScores.scoreTenths })
    .from(kataScores)
    .where(
      and(
        eq(kataScores.matchId, matchId),
        eq(kataScores.judgeRequestId, seatReq.id),
        eq(kataScores.side, s)
      )
    )
    .limit(1);

  await db
    .insert(kataScores)
    .values({
      matchId,
      judgeRequestId: seatReq.id,
      seatNumber,
      side: s,
      scoreTenths: tenths,
      isManual: true,
    })
    .onConflictDoUpdate({
      target: [kataScores.matchId, kataScores.judgeRequestId, kataScores.side],
      set: { scoreTenths: tenths, isManual: true },
    });

  // A correction overwrites an existing mark — audit-log it.
  if (prev && prev.scoreTenths !== tenths) {
    await db.insert(eventLog).values({
      tournamentId: bout.tournamentId,
      ringId,
      categoryId: bout.categoryId,
      action: "JUDGE_SCORE_CORRECTION",
      metadata: {
        matchId,
        seatNumber,
        side: s,
        previousTenths: prev.scoreTenths,
        newTenths: tenths,
        enteredBy: "moderator",
      },
    });
  }

  broadcastLiveEvent({
    table: "kata_scores",
    op: prev ? "UPDATE" : "INSERT",
    matchId,
    ringId,
    categoryId: bout.categoryId,
    data: { seatNumber, side: s, scoreTenths: tenths, isManual: true },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Kata choice
// ---------------------------------------------------------------------------

/**
 * Record the kata each side will perform. Numbers are validated against the
 * official 1-102 list (hard error); the repetition rules are checked against
 * each athlete's history and returned as warnings for the moderator
 * (enforcement UI is P5's job).
 */
export async function setBoutKata(matchId: string, akaKata: number, aoKata: number) {
  const ringId = await ringIdForMatchLocal(matchId);
  if (!ringId) throw new Error("Match is not currently assigned to a ring");
  await authorizeJudgeRing(ringId);

  const bout = await assertKataMatch(matchId);
  if (bout.status === "CONFIRMED") {
    throw new Error("Bout is already confirmed; the kata choice can no longer be changed");
  }

  for (const [label, n] of [["AKA", akaKata], ["AO", aoKata]] as const) {
    if (!Number.isInteger(n) || !isValidKataNumber(n)) {
      throw new Error(`Invalid kata number for ${label}: must be 1-102`);
    }
  }

  const [cat] = await db
    .select({ ageBracket: categories.ageBracket })
    .from(categories)
    .where(eq(categories.id, bout.categoryId))
    .limit(1);
  const ageGroup = deriveAgeGroup(cat?.ageBracket);

  const slots = await db
    .select({ position: matchSlots.position, athleteId: matchSlots.athleteId })
    .from(matchSlots)
    .where(eq(matchSlots.matchId, matchId));
  const akaAthleteId = slots.find((s) => s.position === 1)?.athleteId ?? null;
  const aoAthleteId = slots.find((s) => s.position === 2)?.athleteId ?? null;

  const warnings: string[] = [];
  const sides = [
    { label: "AKA", athleteId: akaAthleteId, kata: akaKata },
    { label: "AO", athleteId: aoAthleteId, kata: aoKata },
  ] as const;
  for (const { label, athleteId, kata } of sides) {
    if (!athleteId) continue;
    const history = await getAthleteKataHistory(bout.tournamentId, athleteId);
    const check = validateKataRepetition(history, kata, ageGroup);
    if (!check.ok && check.reason) warnings.push(`${label}: ${check.reason}`);
  }

  await db
    .update(matches)
    .set({ akaKataNumber: akaKata, aoKataNumber: aoKata })
    .where(eq(matches.id, matchId));

  broadcastLiveEvent({
    table: "matches",
    op: "UPDATE",
    id: matchId,
    matchId,
    ringId,
    categoryId: bout.categoryId,
    status: bout.status,
    data: { akaKata, aoKata },
  });

  return { success: true, warnings };
}

// ---------------------------------------------------------------------------
// Decision + confirmation
// ---------------------------------------------------------------------------

/** Compute the current decision for moderator review (does not confirm). */
export async function computeKataBoutDecision(matchId: string) {
  const ringId = await ringIdForMatchLocal(matchId);
  if (!ringId) throw new Error("Match is not currently assigned to a ring");
  await authorizeJudgeRing(ringId);
  const bout = await assertKataMatch(matchId);

  const rows = await db
    .select({
      judgeRequestId: kataScores.judgeRequestId,
      seatNumber: kataScores.seatNumber,
      side: kataScores.side,
      scoreTenths: kataScores.scoreTenths,
    })
    .from(kataScores)
    .where(eq(kataScores.matchId, matchId));

  try {
    // M2: only the seats' current occupants count — stale marks from a
    // revoked judge are ignored. M4: a disqualified side's marks become 0.0
    // and the opponent wins, via the engine's DQ branch.
    const decision = computeBoutDecisionFromRows(rows, {}, {
      currentBySeat: await currentSeatOccupants(ringId),
      disqualifiedSide:
        bout.disqualifiedSide === "AKA" || bout.disqualifiedSide === "AO"
          ? bout.disqualifiedSide
          : null,
    });
    return {
      success: true,
      decision: {
        winner: decision.winner,
        akaVotes: decision.akaVotes,
        aoVotes: decision.aoVotes,
        akaTotal: decision.akaTotal,
        aoTotal: decision.aoTotal,
        method: KATA_DECISION_METHODS[decision.method],
        judgesCounted: decision.judgesCounted,
      },
    };
  } catch (err) {
    if (err instanceof KataDecisionError) {
      return { success: false as const, error: err.message, needsModeratorDecision: true };
    }
    throw err;
  }
}

/**
 * Confirm a kata bout result.
 *
 * Requires at least one counted judge vote. When votes AND total scores are
 * tied, pass `moderatorDecision` (HANTEI); without it the KataDecisionError
 * is surfaced to the moderator. Writes winnerId/winnerSide/decisionMethod,
 * flips the bout CONFIRMED, publishes the result event, then:
 * - group bout: recompute the group's standings (persisted to
 *   `kata_group_standings`); when ALL group bouts are CONFIRMED, fill the
 *   TBD elimination slots in bracket order and broadcast a draw-update;
 * - single-elimination bout: advance the winner through the draw graph via
 *   the shared `advanceBracketAfterConfirm` (same logic as the kumite path).
 */
export async function confirmKataResult(
  matchId: string,
  moderatorDecision?: "AKA" | "AO"
) {
  const ringId = await ringIdForMatchLocal(matchId);
  if (!ringId) throw new Error("Match is not currently assigned to a ring");
  await authorizeJudgeRing(ringId);

  const bout = await assertKataMatch(matchId);
  // P9 L-3: mirror submitManualScore — only LIVE or COMPLETED bouts can be
  // confirmed. (SCHEDULED/READY have no scores yet; CONFIRMED and BYE are
  // final states, so they are rejected by the same check.)
  if (bout.status !== "LIVE" && bout.status !== "COMPLETED") {
    throw new Error("Only a live or completed bout can be confirmed");
  }

  const scoreRows = await db
    .select({
      judgeRequestId: kataScores.judgeRequestId,
      seatNumber: kataScores.seatNumber,
      side: kataScores.side,
      scoreTenths: kataScores.scoreTenths,
    })
    .from(kataScores)
    .where(eq(kataScores.matchId, matchId));

  let decision;
  try {
    decision = computeBoutDecisionFromRows(
      scoreRows,
      moderatorDecision ? { moderatorDecision } : {},
      {
        // M2: only the seats' current occupants count. M4: a DQ overrides
        // the votes — the disqualified side's marks become 0.0 and the
        // opponent wins (KATA_DISQUALIFICATION).
        currentBySeat: await currentSeatOccupants(ringId),
        disqualifiedSide:
          bout.disqualifiedSide === "AKA" || bout.disqualifiedSide === "AO"
            ? bout.disqualifiedSide
            : null,
      }
    );
  } catch (err) {
    if (err instanceof KataDecisionError) throw new Error(err.message);
    throw err;
  }

  const slots = await db
    .select({ position: matchSlots.position, athleteId: matchSlots.athleteId })
    .from(matchSlots)
    .where(eq(matchSlots.matchId, matchId));
  const winnerAthleteId =
    decision.winner === "AKA"
      ? slots.find((s) => s.position === 1)?.athleteId ?? null
      : slots.find((s) => s.position === 2)?.athleteId ?? null;
  if (!winnerAthleteId) throw new Error("The winning side has no athlete assigned");

  const decisionMethod = KATA_DECISION_METHODS[decision.method];

  await db.transaction(async (tx) => {
    // Serialize concurrent confirms on the match row.
    const locked = await tx.execute(
      sql`select id, status from matches where id = ${matchId} for update`
    );
    const current = (locked as unknown as { id: string; status: string }[])[0];
    if (!current) throw new Error("Match not found");
    if (current.status === "CONFIRMED") {
      throw new Error("Bout was confirmed concurrently; refresh and try again");
    }

    await tx
      .update(matches)
      .set({
        status: "CONFIRMED",
        winnerId: winnerAthleteId,
        winnerSide: decision.winner,
        decisionMethod,
      })
      .where(eq(matches.id, matchId));

    await tx.insert(matchEvents).values({
      matchId,
      seq: 1,
      type: "RESULT_CONFIRMED",
      payload: {
        winnerId: winnerAthleteId,
        side: decision.winner,
        method: decisionMethod,
        akaVotes: decision.akaVotes,
        aoVotes: decision.aoVotes,
        akaTotal: decision.akaTotal,
        aoTotal: decision.aoTotal,
        judgesCounted: decision.judgesCounted,
        disqualifiedSide: bout.disqualifiedSide,
      },
    });

    if (bout.groupId) {
      // Group bout: bookkeeping only (no draw-engine resolution on a pool
      // graph) — the standings + elimination fill-in run after commit.
      await advanceBracketAfterConfirm(tx, {
        categoryId: bout.categoryId,
        matchId,
        winnerId: winnerAthleteId,
        winningSide: decision.winner,
        graph: null,
      });
    } else {
      // Single-elimination kata: advance through the draw graph.
      const [draw] = await tx
        .select()
        .from(draws)
        .where(eq(draws.categoryId, bout.categoryId));
      if (!draw) throw new Error("Draw not found");
      const [latestVersion] = await tx
        .select()
        .from(drawVersions)
        .where(eq(drawVersions.drawId, draw.id))
        .orderBy(sql`${drawVersions.version} desc`)
        .limit(1);
      if (!latestVersion) throw new Error("Draw version not found");
      await advanceBracketAfterConfirm(tx, {
        categoryId: bout.categoryId,
        matchId,
        winnerId: winnerAthleteId,
        winningSide: decision.winner,
        graph: latestVersion.graph as unknown as DrawGraph,
      });
    }
  });

  // Group-stage follow-up (P2 deferred this here): standings now, and the
  // elimination fill-in once every group bout is CONFIRMED.
  let followUp: {
    standings: unknown;
    fillTriggered: boolean;
    filled: number;
    fillError: boolean;
  } | null = null;
  if (bout.groupId) {
    followUp = await confirmGroupBoutFollowUp(bout.categoryId, bout.groupId);
  }

  try {
    revalidatePath(`/moderator/ring/${ringId}`);
  } catch {}

  return {
    success: true,
    winnerSide: decision.winner,
    decisionMethod,
    followUp,
  };
}

/**
 * Retry the elimination fill-in after a failed attempt (see
 * `confirmGroupBoutFollowUp`). Idempotent: already-filled slots are skipped.
 */
export async function retryEliminationFill(categoryId: string) {
  const [assignment] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(eq(categoryAssignments.categoryId, categoryId))
    .limit(1);
  if (!assignment) throw new Error("Category is not assigned to a ring");
  await authorizeJudgeRing(assignment.ringId);
  const { filled } = await fillEliminationBracket(categoryId);
  return { success: true, filled };
}

/**
 * M4: disqualify a side of a kata bout (moderator, ring-bound, kata LIVE
 * bouts only). This is the ONLY legal path to a 0.0 in the decision: the
 * decision engine zeroes the disqualified side's marks and awards the bout
 * to the opponent with method KATA_DISQUALIFICATION. Idempotent per side;
 * calling it again for the other side swaps the flag (both sides can never
 * be disqualified at once — a bout with neither flag is the default).
 *
 * Throws when the bout is already CONFIRMED (a confirmed result is final;
 * the moderator must ask the organiser for a re-open path instead).
 */
export async function disqualifyKataSide(matchId: string, side: "AKA" | "AO") {
  const ringId = await ringIdForMatchLocal(matchId);
  if (!ringId) throw new Error("Match is not currently assigned to a ring");
  await authorizeJudgeRing(ringId);
  const bout = await assertKataMatch(matchId);
  if (bout.status === "CONFIRMED") {
    throw new Error("Bout is already confirmed — the result cannot be disqualified now");
  }

  const [current] = await db
    .select({ disqualifiedSide: matches.disqualifiedSide })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .update(matches)
      .set({ disqualifiedSide: side })
      .where(eq(matches.id, matchId));

    const [maxSeq] = await tx
      .select({ maxSeq: sql<number | null>`max(${matchEvents.seq})` })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId));
    await tx.insert(matchEvents).values({
      matchId,
      seq: (maxSeq?.maxSeq ?? 0) + 1,
      type: "KATA_DISQUALIFIED",
      payload: {
        side,
        previous: current?.disqualifiedSide ?? null,
        recordedBy: "moderator",
      },
    });

    await tx.insert(eventLog).values({
      tournamentId: bout.tournamentId,
      ringId,
      categoryId: bout.categoryId,
      action: "KATA_DISQUALIFIED",
      metadata: { matchId, side, previous: current?.disqualifiedSide ?? null },
    });
  });

  broadcastLiveEvent({
    table: "matches",
    op: "UPDATE",
    categoryId: bout.categoryId,
    ringId,
    tournamentId: bout.tournamentId,
    status: "disqualified",
    data: { matchId, disqualifiedSide: side },
  });
  revalidatePath(`/ring/${ringId}`);
  return { success: true, disqualifiedSide: side };
}

/** Read persisted group standings for a category (moderator tally UI). */
export async function getKataGroupStandings(categoryId: string) {
  const [assignment] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(eq(categoryAssignments.categoryId, categoryId))
    .limit(1);
  if (!assignment) throw new Error("Category is not assigned to a ring");
  await authorizeJudgeRing(assignment.ringId);

  const rows = await db
    .select({
      groupId: kataGroupStandings.groupId,
      standings: kataGroupStandings.standings,
      updatedAt: kataGroupStandings.updatedAt,
    })
    .from(kataGroupStandings)
    .where(eq(kataGroupStandings.categoryId, categoryId));

  return rows.map((r) => ({
    groupId: r.groupId,
    standings: r.standings,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Recompute one group's standings on demand (moderator tally UI refresh). */
export async function refreshKataGroupStandings(categoryId: string, groupId: string) {
  const [assignment] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(eq(categoryAssignments.categoryId, categoryId))
    .limit(1);
  if (!assignment) throw new Error("Category is not assigned to a ring");
  await authorizeJudgeRing(assignment.ringId);
  const standings = await recomputeGroupStandings(categoryId, groupId);
  return { success: true, standings };
}

// ---------------------------------------------------------------------------
// Kata bout tally + helpers (P5)
// ---------------------------------------------------------------------------

export interface KataBoutSeatTally {
  seatNumber: number;
  judgeName: string | null;
  aka: { tenths: number; isManual: boolean } | null;
  ao: { tenths: number; isManual: boolean } | null;
}

/**
 * Per-seat judge tally for a kata bout: seats 1..panelSize with the current
 * occupant's name and each side's mark (null when not submitted).
 *
 * Explicit field selection throughout — `sessionToken` never leaves the DB.
 * Scores are grouped by seatNumber (the stable identity the moderator sees);
 * the judge name is the seat's current occupant. Manual placeholder seats
 * (created by `submitManualScore` for empty seats) carry the
 * "Manual entry · Seat N" name so the moderator can tell them apart.
 */
export async function getKataBoutTally(matchId: string): Promise<{
  matchId: string;
  status: string;
  panelSize: number;
  seats: KataBoutSeatTally[];
  disqualifiedSide: string | null;
}> {
  const ringId = await ringIdForMatchLocal(matchId);
  if (!ringId) throw new Error("Match is not currently assigned to a ring");
  await authorizeJudgeRing(ringId);
  const bout = await assertKataMatch(matchId);
  const panelSize = await panelSizeForRing(ringId);

  const approved = await db
    .select({
      id: judgeRequests.id,
      judgeName: judgeRequests.judgeName,
      seatNumber: judgeRequests.seatNumber,
    })
    .from(judgeRequests)
    .where(
      and(eq(judgeRequests.ringId, ringId), eq(judgeRequests.status, "approved"))
    )
    .orderBy(asc(judgeRequests.seatNumber));

  const scoreRows = await db
    .select({
      judgeRequestId: kataScores.judgeRequestId,
      seatNumber: kataScores.seatNumber,
      side: kataScores.side,
      scoreTenths: kataScores.scoreTenths,
      isManual: kataScores.isManual,
    })
    .from(kataScores)
    .where(eq(kataScores.matchId, matchId));

  const seats: KataBoutSeatTally[] = Array.from(
    { length: panelSize },
    (_, i) => {
      const seatNumber = i + 1;
      const occupant = approved.find((a) => a.seatNumber === seatNumber);
      // M2: a seat's tally shows only its CURRENT occupant's marks — marks
      // from a revoked predecessor's session are excluded (they aren't
      // counted in the decision either).
      const akaRow = scoreRows.find(
        (r) =>
          r.seatNumber === seatNumber &&
          r.side === "AKA" &&
          r.judgeRequestId === occupant?.id
      );
      const aoRow = scoreRows.find(
        (r) =>
          r.seatNumber === seatNumber &&
          r.side === "AO" &&
          r.judgeRequestId === occupant?.id
      );
      return {
        seatNumber,
        judgeName: occupant?.judgeName ?? null,
        aka: akaRow
          ? { tenths: akaRow.scoreTenths, isManual: akaRow.isManual }
          : null,
        ao: aoRow
          ? { tenths: aoRow.scoreTenths, isManual: aoRow.isManual }
          : null,
      };
    }
  );

  return {
    matchId,
    status: bout.status,
    panelSize,
    seats,
    disqualifiedSide: bout.disqualifiedSide,
  };
}

/**
 * Server-authoritative kata check for a category, using P2's
 * `isKataCategory` (definition event_type first, name fallback). The kata
 * console is a kata-mode screen, so it authorizes through the judge ladder.
 */
export async function isKataCategoryForRing(
  ringId: string,
  categoryId: string
): Promise<boolean> {
  await authorizeJudgeRing(ringId);
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!cat) return false;
  return isKataCategory({ tournamentId: cat.tournamentId, name: cat.name });
}

/** Lightweight pending-approval count for the moderator nav badge. */
export async function getPendingJudgeCount(ringId: string): Promise<number> {
  await authorizeJudgeRing(ringId);
  const rows = await db
    .select({ id: judgeRequests.id })
    .from(judgeRequests)
    .where(
      and(
        eq(judgeRequests.ringId, ringId),
        eq(judgeRequests.status, "pending")
      )
    );
  return rows.length;
}

// ---------------------------------------------------------------------------
// NOTE: judge-request serialization lives in src/lib/serializers.ts
// (serializeJudgeRequest). "use server" modules may only export async
// functions — a sync serializer here breaks `next build`.
// ---------------------------------------------------------------------------
