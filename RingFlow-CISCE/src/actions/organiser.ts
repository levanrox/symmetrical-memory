"use server";

import { createClient } from "@/utils/supabase/server";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ensureAdminOwnsTournament } from "./admin";
import { normalizeAccessCode, generateUnambiguousCode } from "@/lib/utils";

/**
 * Organiser requests access to a tournament using a 6-character access code.
 */
export async function requestOrganiserAccess(
  accessCode: string,
  organiserName: string,
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

  const cleanName = (organiserName || "").trim().slice(0, 100);
  if (!cleanName) {
    return { success: false, error: "Please enter your name." };
  }

  const supabase = await createClient();

  // Try to resolve IP
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

  // 1. Locate tournament by organiser_code using Drizzle ORM
  const allTournaments = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      organiserCode: tournaments.organiserCode,
      status: tournaments.status,
    })
    .from(tournaments);

  const normInput = normalizeAccessCode(cleanCode);
  const matchedTournament = allTournaments.find((t) => {
    if (!t.organiserCode) return false;
    return (
      t.organiserCode.trim().toUpperCase() === cleanCode ||
      normalizeAccessCode(t.organiserCode) === normInput
    );
  });

  if (!matchedTournament) {
    return { success: false, error: "Invalid organiser access code. Please check with the administrator." };
  }

  const tournament = matchedTournament;
  const canonicalCode = tournament.organiserCode || cleanCode;

  // 2. Insert into organiser_requests with status 'pending'
  const { data: request, error: reqError } = await supabase
    .from("organiser_requests")
    .insert({
      tournament_id: tournament.id,
      access_code_used: canonicalCode,
      status: "pending",
      organiser_name: cleanName,
      device_info: finalDeviceInfo,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 hours
    })
    .select("id")
    .single();

  if (reqError || !request) {
    console.error("Failed to create organiser request:", reqError);
    return { success: false, error: "Failed to submit access request. Please try again." };
  }

  return { success: true, requestId: request.id, tournamentName: tournament.name };
}

/**
 * Check request status from client waiting room polling or initial load.
 */
export async function checkOrganiserStatus(requestId: string) {
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("organiser_requests")
    .select("status, session_token, tournament_id, expires_at, organiser_name")
    .eq("id", requestId)
    .single();

  if (!request) return { status: "not_found" };

  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    return { status: "expired" };
  }

  if (request.status === "approved") {
    const tokenValue = request.session_token || requestId;
    const cookieStore = await cookies();
    cookieStore.set("org_token", tokenValue, {
      path: "/",
      maxAge: 604800,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return {
    status: request.status,
    sessionToken: request.session_token,
    tournamentId: request.tournament_id,
    organiserName: request.organiser_name,
  };
}

/**
 * Admin approves an incoming organiser request. Multiple organisers can be approved concurrently.
 */
export async function approveOrganiserRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  const sessionToken = crypto.randomUUID();

  const { error: updateError } = await supabase
    .from("organiser_requests")
    .update({ status: "approved", session_token: sessionToken })
    .eq("id", requestId)
    .eq("tournament_id", tournamentId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

/**
 * Admin rejects a pending organiser request.
 */
export async function rejectOrganiserRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  const { error: updateError } = await supabase
    .from("organiser_requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .eq("tournament_id", tournamentId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

/**
 * Admin revokes an approved organiser's active session.
 */
export async function revokeOrganiserSession(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  const supabase = await createClient();

  const { error: updateError } = await supabase
    .from("organiser_requests")
    .update({ status: "revoked", session_token: null })
    .eq("id", requestId)
    .eq("tournament_id", tournamentId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

export async function regenerateOrganiserCode(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const newCode = generateUnambiguousCode(6);

  try {
    await db
      .update(tournaments)
      .set({ organiserCode: newCode })
      .where(eq(tournaments.id, tournamentId));
  } catch (err: any) {
    console.warn("Could not save organiserCode column to tournaments:", err?.message);
  }

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true, organiser_code: newCode };
}

/**
 * Ensures the caller is an authorized organiser for the SPECIFIC tournament.
 * Accepts either:
 * 1) A logged-in Admin who owns the tournament
 * 2) An Organiser with an approved session_token in their org_token cookie.
 */
export async function ensureOrganiserHasAccessToTournament(tournamentId: string) {
  const supabase = await createClient();

  // 1. Check if authenticated admin
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase
      .from("admins")
      .select("id")
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
        return { role: "admin", id: admin.id, tournament };
      }
    }
  }

  // 2. Check org_token cookie
  const cookieStore = await cookies();
  const orgToken = cookieStore.get("org_token")?.value;

  if (!orgToken) {
    throw new Error("Not authenticated: Missing organiser session");
  }

  const { data: request, error } = await supabase
    .from("organiser_requests")
    .select("id, tournament_id, status, organiser_name, session_token, expires_at, tournaments(name)")
    .or(`session_token.eq.${orgToken},id.eq.${orgToken}`)
    .eq("status", "approved")
    .maybeSingle();

  if (error || !request) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    throw new Error("Not authenticated: Invalid or revoked organiser session");
  }

  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    throw new Error("Not authenticated: Organiser session expired");
  }

  if (request.tournament_id !== tournamentId) {
    throw new Error("Not authenticated: Not authorized for this tournament");
  }

  // If token in cookie was request id and session_token is available, sync cookie to session_token
  if (request.session_token && orgToken !== request.session_token) {
    try {
      cookieStore.set("org_token", request.session_token, {
        path: "/",
        maxAge: 604800,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    } catch (_) {}
  }

  return {
    role: "organiser",
    id: request.id,
    name: request.organiser_name,
    tournamentId: request.tournament_id,
    tournament: request.tournaments,
  };
}

/**
 * Ensures the caller has general organiser access.
 */
export async function ensureOrganiser() {
  const supabase = await createClient();

  // Check admin
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase
      .from("admins")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (admin) {
      return { id: admin.id, name: "Administrator", role: "admin" };
    }
  }

  // Check org_token
  const cookieStore = await cookies();
  const orgToken = cookieStore.get("org_token")?.value;

  if (!orgToken) {
    throw new Error("Not authenticated");
  }

  const { data: request } = await supabase
    .from("organiser_requests")
    .select("id, tournament_id, status, organiser_name, session_token, expires_at")
    .or(`session_token.eq.${orgToken},id.eq.${orgToken}`)
    .eq("status", "approved")
    .maybeSingle();

  if (!request || (request.expires_at && new Date(request.expires_at).getTime() < Date.now())) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    throw new Error("Not authenticated");
  }

  // Synchronize cookie to session_token if needed
  if (request.session_token && orgToken !== request.session_token) {
    try {
      cookieStore.set("org_token", request.session_token, {
        path: "/",
        maxAge: 604800,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    } catch (_) {}
  }

  return {
    id: request.id,
    name: request.organiser_name,
    role: "organiser",
    tournamentId: request.tournament_id,
  };
}

/**
 * Validates the current organiser session without risk of aggressive client-side deletion.
 * Returns valid: true on transient database errors to protect user sessions during offline/reconnects.
 */
export async function validateOrganiserSessionAction(token?: string) {
  const cookieStore = await cookies();
  const orgToken = token || cookieStore.get("org_token")?.value;
  if (!orgToken) return { valid: false, reason: "missing" };

  const supabase = await createClient();
  const { data: request, error } = await supabase
    .from("organiser_requests")
    .select("id, status, organiser_name, tournament_id, expires_at")
    .or(`session_token.eq.${orgToken},id.eq.${orgToken}`)
    .maybeSingle();

  if (error) {
    // Network or temporary DB error: do NOT revoke session
    return { valid: true, error: error.message };
  }

  if (!request) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    return { valid: false, reason: "not_found" };
  }

  if (request.status === "revoked" || request.status === "rejected") {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    return { valid: false, reason: "revoked", requestId: request.id };
  }

  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    return { valid: false, reason: "expired", requestId: request.id };
  }

  return {
    valid: true,
    requestId: request.id,
    status: request.status,
    organiserName: request.organiser_name,
    tournamentId: request.tournament_id,
  };
}

/**
 * Log out the current organiser session.
 */
export async function logoutOrganiser() {
  const cookieStore = await cookies();
  cookieStore.delete("org_token");
  cookieStore.delete("org_name");
  return { success: true };
}
