"use server";

import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "./admin";

export async function updateTournamentSettings(
  tournamentId: string,
  data: {
    name: string;
    event_date: string;
    status: string;
    venue: string;
    city: string;
    show_public_draws?: boolean;
    show_public_scoreboard?: boolean;
  }
) {
  await ensureAdminOwnsTournament(tournamentId);

  const eventDate = data.event_date ? data.event_date.split("T")[0] : null;

  await db
    .update(tournaments)
    .set({
      name: data.name,
      eventDate,
      status: data.status,
      venue: data.venue || null,
      city: data.city || null,
      showPublicDraws: data.show_public_draws ?? true,
      showPublicScoreboard: data.show_public_scoreboard ?? false,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  revalidatePath(`/admin`);
  revalidatePath(`/organiser`);
  revalidatePath(`/public/event/${tournamentId}`);
}

export async function deleteTournament(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));

  redirect("/admin");
}
