import type { NextConfig } from "next";

// Extra dev origins come from the environment (comma-separated) so LAN /
// Tailscale hosts are not hardcoded: e.g.
// ALLOWED_DEV_ORIGINS="192.168.1.9,100.111.174.126"
const extraDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // NOTE: no `output: "standalone"` — the app runs behind the custom
  // server.mjs (which needs the full Next install to stamp the trusted
  // `x-rf-peer` header for the LAN gate / rate limiter, P9 H-1). The Docker
  // runner installs full prod dependencies and runs `node server.mjs`.
  // In development Next blocks requests to /_next/* that carry an Origin from a
  // host it does not recognise. Opening the app on a LAN or Tailscale address
  // then fails to load its dev assets, so the page never hydrates and buttons
  // (including the admin login) do nothing. List every host you load the app
  // from via ALLOWED_DEV_ORIGINS (see above).
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "*.local",
    ...extraDevOrigins,
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
