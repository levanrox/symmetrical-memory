#!/usr/bin/env node
// Runs the PostgREST gateway and the Next.js dev server together, and shuts both
// down when either one exits or on Ctrl+C. Assumes `db` + `postgrest` are already
// up (see the `dev:local` script in package.json).

import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function run(label, command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);

  const forward = (stream, out) => {
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) out.write(`[${label}] ${line}\n`);
      }
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n[${label}] exited with code ${code ?? 0}`);
    shutdown();
  });

  return child;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting PostgREST gateway (:54321 -> :54322) and Next.js dev server...");
run("gateway", process.execPath, ["scripts/postgrest-gateway.cjs"]);
run("next", "npm", ["run", "dev"]);
