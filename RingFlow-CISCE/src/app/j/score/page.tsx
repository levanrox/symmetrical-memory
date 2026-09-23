import type { Metadata } from "next";
import { ScoreClient } from "./ScoreClient";

export const metadata: Metadata = {
  title: "Judge Scoring | RingFlow",
  description: "Score kata bouts live from your phone.",
};

export default function JudgeScorePage() {
  return <ScoreClient />;
}
