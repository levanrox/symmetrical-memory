import type { Metadata } from "next";
import { JoinClient } from "./JoinClient";

export const metadata: Metadata = {
  title: "Join as Judge | RingFlow",
  description: "Join a tatami judging panel from your phone.",
};

export default async function JudgeJoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <JoinClient code={decodeURIComponent(code)} />;
}
