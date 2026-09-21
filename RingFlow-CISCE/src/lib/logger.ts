/**
 * Structured server-side logging (pino → JSON on stdout).
 *
 * Replaces ad-hoc `console.*` in server code. Level comes from LOG_LEVEL
 * (default: debug in development, info in production). Docker picks the JSON
 * lines up with log rotation configured in docker-compose.yml.
 *
 * Server-only: never import from client components ("use client" files keep
 * using console — pino targets Node streams).
 */

import pino from "pino";

const level =
  process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level,
  // In production the timestamp pino adds is enough; keep the base minimal.
  base: { pid: process.pid },
});
