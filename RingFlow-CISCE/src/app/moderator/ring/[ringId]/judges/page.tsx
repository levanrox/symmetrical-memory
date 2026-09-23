import React from "react";
import JudgeDeskClient from "@/components/moderator/JudgeDeskClient";

export default async function ModeratorJudgesPage({
  params,
}: {
  params: Promise<{ ringId: string }>;
}) {
  const { ringId } = await params;
  return <JudgeDeskClient ringId={ringId} />;
}
