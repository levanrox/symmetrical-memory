import React from "react";
import { getRingActiveBout } from "@/actions/matches";
import { ScoreboardClient } from "@/components/scoreboard/ScoreboardClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Scoreboard",
};

export default async function ScoreboardPage({ params }: { params: Promise<{ ringId: string }> }) {
  const { ringId } = await params;
  const initialData = await getRingActiveBout(ringId);

  return <ScoreboardClient ringId={ringId} initialData={initialData} />;
}
