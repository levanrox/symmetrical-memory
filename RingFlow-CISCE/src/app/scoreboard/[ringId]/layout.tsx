import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateModeratorSession } from "@/actions/moderator";

export default async function ScoreboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ringId: string }>;
}) {
  const { ringId } = await params;

  const cookieStore = await cookies();
  const token = cookieStore.get("mod_token")?.value;

  if (!token) {
    redirect("/login/mod");
  }

  const session = await validateModeratorSession(ringId, token);
  if (!session) {
    redirect("/login/mod");
  }

  return <>{children}</>;
}
