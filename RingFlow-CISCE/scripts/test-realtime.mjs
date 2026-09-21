#!/usr/bin/env node
/**
 * Smoke test for the self-hosted Supabase Realtime broadcast channel.
 *
 * Subscribes to the `ringflow:live` channel and prints every LiveEvent it
 * receives. In another terminal, trigger a change — e.g. update a match score
 * in the app, or run:
 *
 *   psql "$DATABASE_URL" -c "UPDATE matches SET aka_score = aka_score + 1 WHERE id = '<a-match-id>';"
 *
 * Usage: node scripts/test-realtime.mjs
 */

import { RealtimeClient } from "@supabase/realtime-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const base = (
  process.env.NEXT_PUBLIC_REALTIME_URL ||
  process.env.REALTIME_URL ||
  "http://localhost:4000"
).replace(/\/+$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Run: node scripts/gen-supabase-secrets.mjs");
  process.exit(1);
}

const client = new RealtimeClient(`${base}/socket`, { params: { apikey: anonKey } });
const channel = client.channel("ringflow:live");

channel.on("broadcast", { event: "change" }, ({ payload }) => {
  console.log("EVENT:", JSON.stringify(payload));
});

channel.subscribe((status) => {
  console.log("channel status:", status);
  if (status === "SUBSCRIBED") {
    console.log("Listening for live events — trigger a change in the app now. Ctrl+C to stop.");
  }
});
