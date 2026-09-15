"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ensureAdminOwnsTournament } from "./admin";
import { normalizeAccessCode, generateUnambiguousCode } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StagerCode = {
  code: string;
  label: string;
};

// ─── Public: Request stager access ────────────────────────────────────────────

/**
 * Stager submits their access code + name to request tournament access.
 * Validates code against the stager_codes JSONB array on the tournament.
 */
export async function requestStagerAccess(
  accessCode: string,
  stagerName: string,
  deviceInfo?: any,
  turnstileToken?: string
) {
  if (!turnstileToken) {
    return { success: false, error: "Security check is required." };
  }

  const { verifyTurnstileToken } = await import("./turnstile");
  const verification = await verifyTurnstileToken(turnstileToken);
  if (!verification.success) {
    return { success: false, error: verification.error || "Security check failed." };
  }

  const cleanCode = (accessCode || "").trim().toUpperCase();
  if (cleanCode.length < 6) {
    return { success: false, error: "Please enter a valid 6-character access code." };
  }

  const cleanName = (stagerName || "").trim().slice(0, 100);
  if (!cleanName) {
    return { success: false, error: "Please enter your name." };
  }

  const supabase = await createClient();

  // Resolve IP from headers
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  let ip = "Unknown";
  if (forwardedFor) {
    ip = forwardedFor.split(",")[0].trim();
  } else {
    ip = headersList.get("x-real-ip") || "Unknown";
  }

  const finalDeviceInfo = {
    ...deviceInfo,
    ip: deviceInfo?.ip && deviceInfo.ip !== "Unknown" ? deviceInfo.ip : ip,
  };

  // Find a tournament that has this code in its stager_codes JSONB array.
  // Filter to non-completed tournaments — stager codes are only valid during
  // active/draft events. Excluding completed tournaments reduces the dataset
  // scanned and the amount of JSONB data returned.
  const { data: tournaments, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id, name, stager_codes")
    .in("status", ["draft", "active"]);


  if (tournamentError || !tournaments) {
    return { success: false, error: "Failed to validate access code. Please try again." };
  }

  // Match code against each tournament's stager_codes array (with normalization to prevent O/0 and I/1 confusion)
  const normInput = normalizeAccessCode(cleanCode);
  let matchedTournament: { id: string; name: string } | null = null;
  let canonicalCode = cleanCode;

  for (const t of tournaments) {
    const codes: StagerCode[] = Array.isArray(t.stager_codes) ? t.stager_codes : [];
    const matched = codes.find((c) => normalizeAccessCode(c.code) === normInput);
    if (matched) {
      matchedTournament = { id: t.id, name: t.name };
      canonicalCode = matched.code.toUpperCase();
      break;
    }
  }

  if (!matchedTournament) {
    return { success: false, error: "Invalid stager access code. Please check with the tournament director." };
  }

  // Check if this code already has an active (approved) session
  const { data: existingActiveList } = await supabase
    .from("stager_requests")
    .select("id, status, access_code_used, expires_at")
    .eq("tournament_id", matchedTournament.id)
    .eq("status", "approved");

  const hasActiveSession = (existingActiveList || []).some((r) => {
    const isNotExpired = !r.expires_at || new Date(r.expires_at).getTime() > Date.now();
    return isNotExpired && normalizeAccessCode(r.access_code_used) === normInput;
  });

  if (hasActiveSession) {
    return {
      success: false,
      error: "This stager code is already in use by an active session. Each code allows one user at a time.",
    };
  }

  // Insert stager request using the tournament's canonical code format
  const { data: request, error: reqError } = await supabase
    .from("stager_requests")
    .insert({
      tournament_id: matchedTournament.id,
      access_code_used: canonicalCode,
      status: "pending",
      stager_name: cleanName,
      device_info: finalDeviceInfo,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 hours
    })
    .select("id")
    .single();

  if (reqError || !request) {
    console.error("Failed to create stager request:", reqError);
    return { success: false, error: "Failed to submit access request. Please try again." };
  }

  return { success: true, requestId: request.id, tournamentName: matchedTournament.name };
}

// ─── Public: Poll request status (waiting room) ────────────────────────────

export async function checkStagerStatus(requestId: string) {
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("stager_requests")
    .select("status, session_token, tournament_id, expires_at, stager_name")
    .eq("id", requestId)
    .single();

  if (!request) return { status: "not_found" };

  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    return { status: "expired" };
  }

  if (request.status === "approved" && request.session_token) {
    const cookieStore = await cookies();
    cookieStore.set("stager_token", request.session_token, {
      path: "/",
      maxAge: 604800, // 7 days
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    if (request.stager_name) {
      cookieStore.set("stager_name", encodeURIComponent(request.stager_name), {
        path: "/",
        maxAge: 604800, // 7 days
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  }

  return {
    status: request.status,
    sessionToken: request.session_token,
    tournamentId: request.tournament_id,
    stagerName: request.stager_name,
  };
}

// ─── Admin: Approve / Reject / Revoke ─────────────────────────────────────

export async function approveStagerRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  // Find the request to get its access_code_used
  const { data: targetReq } = await supabase
    .from("stager_requests")
    .select("access_code_used")
    .eq("id", requestId)
    .eq("tournament_id", tournamentId)
    .single();

  // Revoke any existing approved sessions using this code (or equivalent normalized code)
  if (targetReq?.access_code_used) {
    const { data: activeSessions } = await supabase
      .from("stager_requests")
      .select("id, access_code_used")
      .eq("tournament_id", tournamentId)
      .eq("status", "approved");

    const targetNorm = normalizeAccessCode(targetReq.access_code_used);
    const toRevokeIds = (activeSessions || [])
      .filter((s) => normalizeAccessCode(s.access_code_used) === targetNorm && s.id !== requestId)
      .map((s) => s.id);

    if (toRevokeIds.length > 0) {
      await supabase
        .from("stager_requests")
        .update({ status: "revoked", session_token: null })
        .in("id", toRevokeIds);
    }
  }

  const sessionToken = crypto.randomUUID();

  const { error } = await supabase
    .from("stager_requests")
    .update({ status: "approved", session_token: sessionToken })
    .eq("id", requestId)
    .eq("tournament_id", tournamentId);

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

export async function rejectStagerRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("stager_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("tournament_id", tournamentId);

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

export async function revokeStagerSession(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("stager_requests")
    .update({ status: "revoked", session_token: null })
    .eq("id", requestId)
    .eq("tournament_id", tournamentId);

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

// ─── Admin: Generate stager codes ─────────────────────────────────────────

/**
 * Generates N new unique 6-char stager codes and APPENDS them to stager_codes.
 * Existing codes are never overwritten - codes accumulate so stagers can be
 * added at any point during the tournament.
 */
export async function generateStagerCodes(tournamentId: string, count: number) {
  await ensureAdminOwnsTournament(tournamentId);
  if (count < 1 || count > 50) {
    throw new Error("Count must be between 1 and 50.");
  }

  const supabase = await createClient();

  // Fetch existing codes
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("stager_codes")
    .eq("id", tournamentId)
    .single();

  const existing: StagerCode[] = Array.isArray(tournament?.stager_codes)
    ? tournament.stager_codes
    : [];

  const usedCodes = new Set(existing.map((c) => normalizeAccessCode(c.code)));

  const newCodes: StagerCode[] = [];
  let attempts = 0;
  const startIndex = existing.length + 1;

  while (newCodes.length < count && attempts < 1000) {
    attempts++;
    const candidate = generateUnambiguousCode(6);
    const normCandidate = normalizeAccessCode(candidate);
    if (!usedCodes.has(normCandidate)) {
      usedCodes.add(normCandidate);
      newCodes.push({
        code: candidate,
        label: `Stager ${startIndex + newCodes.length}`,
      });
    }
  }

  const merged = [...existing, ...newCodes];

  const { error } = await supabase
    .from("tournaments")
    .update({ stager_codes: merged })
    .eq("id", tournamentId);

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, stager_codes: merged };
}

/**
 * Remove a single stager code by its code value.
 */
export async function removeStagerCode(tournamentId: string, code: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("stager_codes")
    .eq("id", tournamentId)
    .single();

  const existing: StagerCode[] = Array.isArray(tournament?.stager_codes)
    ? tournament.stager_codes
    : [];

  const updated = existing.filter((c) => c.code.toUpperCase() !== code.toUpperCase());

  const { error } = await supabase
    .from("tournaments")
    .update({ stager_codes: updated })
    .eq("id", tournamentId);

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, stager_codes: updated };
}

// ─── Stager Auth Helpers ───────────────────────────────────────────────────

/**
 * Validates the stager_token cookie and checks it belongs to the given tournament.
 * Also allows authenticated admins who own the tournament.
 */
export async function ensureStagerHasAccessToTournament(tournamentId: string) {
  const supabase = await createClient();
  const cookieStore = await cookies();

  // 1. Check stager_token cookie first so the stager's actual registered name is used
  const stagerToken = cookieStore.get("stager_token")?.value;
  if (stagerToken) {
    const { data: request } = await supabase
      .from("stager_requests")
      .select("id, tournament_id, status, stager_name, session_token, expires_at, tournaments(name)")
      .or(`session_token.eq.${stagerToken},id.eq.${stagerToken}`)
      .eq("status", "approved")
      .maybeSingle();

    if (request && request.tournament_id === tournamentId) {
      if (!request.expires_at || new Date(request.expires_at).getTime() >= Date.now()) {
        const cookieName = cookieStore.get("stager_name")?.value;
        const finalName = request.stager_name || (cookieName ? decodeURIComponent(cookieName) : "Stager");
        return {
          role: "stager",
          id: request.id,
          name: finalName,
          tournamentId: request.tournament_id,
          tournament: (request as any).tournaments,
        };
      }
    }
  }

  // 2. Fallback: Allow authenticated admin who owns the tournament (for admin testing/preview)
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase
      .from("admins")
      .select("id, email")
      .eq("id", user.id)
      .maybeSingle();

    if (admin) {
      const { data: tournament } = await supabase
        .from("tournaments")
        .select("id, name")
        .eq("id", tournamentId)
        .eq("admin_id", admin.id)
        .maybeSingle();

      if (tournament) {
        const cookieName = cookieStore.get("stager_name")?.value;
        const resolvedName = cookieName
          ? decodeURIComponent(cookieName)
          : user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Admin";

        return { role: "admin", id: admin.id, name: resolvedName, tournament };
      }
    }
  }

  if (!stagerToken) {
    throw new Error("Not authenticated: Missing stager session");
  }

  throw new Error("Unauthorized: Invalid or expired stager session");
}

/**
 * General stager check (used in middleware-like contexts).
 */
export async function ensureStager() {
  const supabase = await createClient();
  const cookieStore = await cookies();

  const stagerToken = cookieStore.get("stager_token")?.value;
  if (stagerToken) {
    const { data: request } = await supabase
      .from("stager_requests")
      .select("id, tournament_id, status, stager_name, expires_at")
      .or(`session_token.eq.${stagerToken},id.eq.${stagerToken}`)
      .eq("status", "approved")
      .maybeSingle();

    if (request && (!request.expires_at || new Date(request.expires_at).getTime() >= Date.now())) {
      return {
        id: request.id,
        name: request.stager_name,
        role: "stager",
        tournamentId: request.tournament_id,
      };
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase
      .from("admins")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (admin) {
      const cookieName = cookieStore.get("stager_name")?.value;
      const adminName = cookieName
        ? decodeURIComponent(cookieName)
        : user.user_metadata?.full_name || user.user_metadata?.name || "Administrator";
      return { id: admin.id, name: adminName, role: "admin" };
    }
  }

  throw new Error("Not authenticated");
}

export async function logoutStager() {
  const cookieStore = await cookies();
  cookieStore.delete("stager_token");
  cookieStore.delete("stager_name");
  return { success: true };
}

// ─── Stager Board Action: Update category status ───────────────────────────

/**
 * Stager clicks "In Progress" or "Called" on a category card.
 * If the same status is clicked again, it clears (toggles off).
 */
export async function updateCategoryStagerStatus(
  categoryId: string,
  tournamentId: string,
  newStatus: "calling" | "ready" | null,
  stagerName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate stager has access and get canonical stager name
    let stagerInfo: Awaited<ReturnType<typeof ensureStagerHasAccessToTournament>>;
    try {
      stagerInfo = await ensureStagerHasAccessToTournament(tournamentId);
    } catch (err: any) {
      return { success: false, error: err?.message || "Unauthorized: Invalid or expired stager session." };
    }

    const effectiveName = stagerName && stagerName !== "Stager"
      ? stagerName
      : (stagerInfo.name || "Stager");

    const supabase = await createClient();

    // Verify the category belongs to a ring in this tournament
    const { data: assignment } = await supabase
      .from("category_assignments")
      .select("category_id, ring_id, rings!inner(tournament_id)")
      .eq("category_id", categoryId)
      .maybeSingle();

    if (!assignment) {
      return { success: false, error: "Category is not assigned to any ring yet." };
    }
    if ((assignment.rings as any)?.tournament_id !== tournamentId) {
      return { success: false, error: "Unauthorized: Category does not belong to this tournament." };
    }

    const { error } = await supabase
      .from("category_assignments")
      .update({
        stager_status: newStatus,
        stager_name: newStatus ? effectiveName : null,
        stager_action_at: newStatus ? new Date().toISOString() : null,
      })
      .eq("category_id", categoryId);

    if (error) {
      return { success: false, error: `Failed to update category status: ${error.message || "DB error"}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Unexpected error updating stager status" };
  }
}
