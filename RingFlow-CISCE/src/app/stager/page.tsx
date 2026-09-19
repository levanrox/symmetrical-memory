import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/db";
import { stagerRequests as stagerRequestsTable } from "@/db/schema";
import { eq, or, and, desc } from "drizzle-orm";

/**
 * /stager root - resolves active stager session and navigates directly to event balance
 */
export default async function StagerRootPage() {
  const cookieStore = await cookies();
  const stagerToken = cookieStore.get("stager_token")?.value;

  if (!stagerToken) {
    redirect("/login/stager");
  }

  const [request] = await db
    .select({
      tournamentId: stagerRequestsTable.tournamentId,
      status: stagerRequestsTable.status,
      expiresAt: stagerRequestsTable.expiresAt,
    })
    .from(stagerRequestsTable)
    .where(
      and(
        or(
          eq(stagerRequestsTable.sessionToken, stagerToken),
          eq(stagerRequestsTable.id, stagerToken)
        ),
        eq(stagerRequestsTable.status, "approved")
      )
    )
    .orderBy(desc(stagerRequestsTable.createdAt))
    .limit(1);

  if (
    request?.tournamentId &&
    (!request.expiresAt || new Date(request.expiresAt).getTime() >= Date.now())
  ) {
    redirect(`/stager/event/${request.tournamentId}/balance`);
  }

  redirect("/login/stager");
}
