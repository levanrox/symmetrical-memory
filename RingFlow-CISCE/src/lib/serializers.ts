/**
 * Serializers bridging Drizzle database models to frontend components.
 * Provides both camelCase and snake_case properties to ensure 100% compatibility
 * across all existing UI components without regressions.
 */

export function serializeTournament(t: any) {
  if (!t) return null;
  return {
    ...t,
    id: t.id,
    admin_id: t.adminId,
    name: t.name,
    event_date: t.eventDate ? String(t.eventDate) : null,
    eventDate: t.eventDate ? String(t.eventDate) : null,
    venue: t.venue,
    city: t.city,
    status: t.status,
    organiser_code: t.organiserCode,
    stager_codes: t.stagerCodes || [],
    show_public_draws: t.showPublicDraws ?? true,
    show_public_scoreboard: t.showPublicScoreboard ?? false,
    default_bronze_medals: t.defaultBronzeMedals ?? 2,
    created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
    updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
  };
}

export function serializeRing(r: any, opts?: { includeAccessCode?: boolean }) {
  if (!r) return null;
  // The ring moderator access code is a credential: it is only included when
  // the caller explicitly opts in (admin contexts). Public/role pages must
  // never receive it — anyone with the code can request moderator access.
  const includeAccessCode = opts?.includeAccessCode === true;
  const { accessCode: _droppedCode, ...rest } = r;
  return {
    ...rest,
    id: r.id,
    tournament_id: r.tournamentId,
    name: r.name,
    ring_order: r.ringOrder,
    ...(includeAccessCode ? { access_code: r.accessCode } : {}),
    timer_status: r.timerStatus || 'idle',
    timer_started_at: r.timerStartedAt ? new Date(r.timerStartedAt).toISOString() : null,
    timer_paused_at: r.timerPausedAt ? new Date(r.timerPausedAt).toISOString() : null,
    timer_accumulated_seconds: r.timerAccumulatedSeconds ?? 0,
    timer_duration_ms: r.timerDurationMs ?? 180000,
    timer_accumulated_ms: r.timerAccumulatedMs ?? 0,
    sides_swapped: r.sidesSwapped ?? false,
    current_match_id: r.currentMatchId ?? null,
    match_duration_seconds: r.matchDurationSeconds ?? 180,
    mat_name: r.matName ?? null,
  };
}

export function serializeCategory(c: any) {
  if (!c) return null;
  return {
    ...c,
    id: c.id,
    tournament_id: c.tournamentId,
    name: c.name,
    gender: c.gender,
    discipline: c.discipline,
    age_category: c.ageCategory,
    weight_category: c.weightCategory,
    sub_category: c.subCategory,
    status: c.status,
    athletes_count: c.athletesCount ?? 0,
    expected_matches: c.expectedMatches ?? 0,
    doc_url: c.docUrl,
    custom_rules: c.customRules,
    bronze_medals: c.bronzeMedals ?? c.bronze_medals ?? null,
    draw_state: c.drawState ?? c.draw_state ?? null,
    is_locked: (c.drawState ?? c.draw_state) === "LOCKED",
    confirmed_matches: c.confirmedMatches ?? c.confirmed_matches ?? 0,
    live_matches: c.liveMatches ?? c.live_matches ?? 0,
    has_draw: c.hasDraw ?? c.has_draw ?? false,
    created_at: c.createdAt ? new Date(c.createdAt).toISOString() : null,
  };
}

export function serializeCategoryAssignment(a: any, category?: any) {
  if (!a) return null;
  const serializedCat = category ? serializeCategory(category) : a.categories ? serializeCategory(a.categories) : null;
  return {
    ...a,
    id: a.id,
    ring_id: a.ringId,
    category_id: a.categoryId,
    queue_order: a.queueOrder,
    status: a.status,
    matches_completed: a.matchesCompleted ?? 0,
    allocated_at: a.allocatedAt ? new Date(a.allocatedAt).toISOString() : null,
    completed_at: a.completedAt ? new Date(a.completedAt).toISOString() : null,
    paused_at: a.pausedAt ? new Date(a.pausedAt).toISOString() : null,
    pause_duration_seconds: a.pauseDurationSeconds ?? 0,
    categories: serializedCat,
  };
}

export function serializeModRequest(mr: any, ring?: any) {
  if (!mr) return null;
  // Explicit field selection — never spread the row: the sessionToken column
  // is a live credential and must never leave the server in a response body.
  return {
    id: mr.id,
    ring_id: mr.ringId,
    tournament_id: mr.tournamentId,
    status: mr.status,
    access_code_used: mr.accessCodeUsed ?? null,
    device_info: mr.deviceInfo,
    moderator_name: mr.moderatorName,
    created_at: mr.createdAt ? new Date(mr.createdAt).toISOString() : null,
    updated_at: mr.updatedAt ? new Date(mr.updatedAt).toISOString() : null,
    expires_at: mr.expiresAt ? new Date(mr.expiresAt).toISOString() : null,
    rings: ring ? { name: ring.name } : mr.ring ? { name: mr.ring.name } : undefined,
  };
}

export function serializeEventLog(el: any) {
  if (!el) return null;
  return {
    ...el,
    id: el.id,
    tournament_id: el.tournamentId,
    ring_id: el.ringId,
    category_id: el.categoryId,
    action: el.action,
    metadata: el.metadata,
    created_at: el.createdAt ? new Date(el.createdAt).toISOString() : null,
  };
}

export function serializeAthlete(a: any, categoryName?: string | null) {
  if (!a) return null;
  return {
    ...a,
    id: a.id,
    tournament_id: a.tournamentId,
    category_id: a.categoryId,
    name: a.name,
    school: a.school,
    dojo: a.dojo,
    belt: a.belt,
    weight: a.weight,
    gender: a.gender,
    chest_number: a.chestNumber,
    chestNumber: a.chestNumber,
    seed: a.seed,
    created_at: a.createdAt ? new Date(a.createdAt).toISOString() : null,
    updated_at: a.updatedAt ? new Date(a.updatedAt).toISOString() : null,
    categories: categoryName ? { name: categoryName } : a.category ? { name: a.category.name } : undefined,
  };
}

export function serializeOrganiserRequest(or: any) {
  if (!or) return null;
  // No spread: the session_token column is a live credential and is never
  // included in serialized output.
  return {
    id: or.id,
    tournament_id: or.tournamentId || or.tournament_id,
    access_code_used: or.accessCodeUsed || or.access_code_used,
    status: or.status,
    device_info: or.deviceInfo || or.device_info,
    organiser_name: or.organiserName || or.organiser_name,
    expires_at: or.expiresAt ? new Date(or.expiresAt).toISOString() : (or.expires_at || null),
    created_at: or.createdAt ? new Date(or.createdAt).toISOString() : (or.created_at || null),
    updated_at: or.updatedAt ? new Date(or.updatedAt).toISOString() : (or.updated_at || null),
  };
}

export function serializeStagerRequest(sr: any) {
  if (!sr) return null;
  // No spread: the session_token column is a live credential and is never
  // included in serialized output.
  return {
    id: sr.id,
    tournament_id: sr.tournamentId || sr.tournament_id,
    access_code_used: sr.accessCodeUsed || sr.access_code_used,
    stager_name: sr.stagerName || sr.stager_name,
    status: sr.status,
    device_info: sr.deviceInfo || sr.device_info,
    expires_at: sr.expiresAt ? new Date(sr.expiresAt).toISOString() : (sr.expires_at || null),
    created_at: sr.createdAt ? new Date(sr.createdAt).toISOString() : (sr.created_at || null),
    updated_at: sr.updatedAt ? new Date(sr.updatedAt).toISOString() : (sr.updated_at || null),
  };
}

/**
 * Serialize a judge request for moderator lists (P3).
 *
 * Explicit field selection — never spread the row: the `sessionToken`
 * column is a live credential and must never leave the server (C1 lesson).
 */
export function serializeJudgeRequest(jr: any) {
  if (!jr) return null;
  return {
    id: jr.id,
    ring_id: jr.ringId ?? jr.ring_id,
    join_code_used: jr.joinCodeUsed ?? jr.join_code_used,
    judge_name: jr.judgeName ?? jr.judge_name,
    seat_number: jr.seatNumber ?? jr.seat_number ?? null,
    status: jr.status,
    expires_at: jr.expiresAt ? new Date(jr.expiresAt).toISOString() : (jr.expires_at || null),
    created_at: jr.createdAt ? new Date(jr.createdAt).toISOString() : (jr.created_at || null),
  };
}
