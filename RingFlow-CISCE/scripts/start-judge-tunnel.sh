#!/usr/bin/env bash
# RingFlow judge-access tunnel (PHASE P7a).
#
#   ./scripts/start-judge-tunnel.sh            # tunnels http://localhost:3000
#   PORT=8080 ./scripts/start-judge-tunnel.sh  # tunnel a different local port
#
# Starts a Cloudflare Quick Tunnel (https://*.trycloudflare.com) pointing at
# the local RingFlow server, prints the public URL prominently, and cleans
# up the tunnel on Ctrl+C. No Cloudflare account, config file, or DNS record
# needed — the URL is random per run.
#
# Judges open the printed URL on their phones to reach the /j/* judge pages.
# Staff pages (/admin, /moderator, /organiser, /stager) stay LAN-only: the
# app's proxy returns 404 for them on public client IPs (see src/proxy.ts),
# so the tunnel does not expose staff controls to the internet.
#
# Requires: cloudflared, grep.
set -euo pipefail

PORT="${PORT:-3000}"
LOCAL_URL="http://localhost:${PORT}"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ── Preconditions ───────────────────────────────────────────────────────────
if ! command -v cloudflared >/dev/null 2>&1; then
  cat >&2 << 'EOF'
ERROR: cloudflared is not installed or not on PATH.

Install it first:

  macOS (Homebrew):   brew install cloudflared
  Linux (deb):        curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb \
                        && sudo dpkg -i /tmp/cloudflared.deb
  Linux (rpm):        curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm -o /tmp/cloudflared.rpm \
                        && sudo rpm -ivh /tmp/cloudflared.rpm
  Windows (winget):   winget install --id Cloudflare.cloudflared
  Windows (choco):    choco install cloudflared

Then re-run this script. Verify with: cloudflared --version
EOF
  exit 1
fi
command -v grep >/dev/null 2>&1 || die "grep is not installed or not on PATH."

# ── Start tunnel, watch its output for the public URL ───────────────────────
# NOTE: cloudflared prints the assigned URL to its log (usually stderr). We
# capture its output to a temp file and follow it with `tail -F`, which is
# portable across macOS/Linux (GNU `tail --pid` is NOT available on macOS).
LOG="$(mktemp "${TMPDIR:-/tmp}/ringflow-tunnel.XXXXXX")"
CLOUDFLARED_PID=""
PARSER_PID=""

# Stop the log-streaming pipeline. `tail -F` can outlive the parser
# subshell, so match it by our unique log path too (pgrep never matches
# itself, and nothing else references that temp name).
kill_tree() {
  [ -n "${PARSER_PID}" ] && kill "${PARSER_PID}" 2>/dev/null || true
  # shellcheck disable=SC2046
  for tp in $(pgrep -f "${LOG##*/}" 2>/dev/null || true); do
    kill "${tp}" 2>/dev/null || true
  done
}
cleanup() {
  kill_tree
  if [ -n "${CLOUDFLARED_PID}" ]; then
    kill "${CLOUDFLARED_PID}" 2>/dev/null || true
    wait "${CLOUDFLARED_PID}" 2>/dev/null || true
  fi
  rm -f "${LOG}"
}
stopping() {
  say ""
  say "Shutting down tunnel..."
  cleanup
  say "Tunnel stopped."
}
# INT/TERM: stop the tunnel and exit. EXIT: normal cleanup path.
trap 'trap - EXIT; stopping; exit 130' INT TERM
trap cleanup EXIT

say "Starting Cloudflare Quick Tunnel -> ${LOCAL_URL} ..."
say "(press Ctrl+C to stop the tunnel)"
say ""

cloudflared tunnel --url "${LOCAL_URL}" >"${LOG}" 2>&1 &
CLOUDFLARED_PID="$!"

# Stream the tunnel log in the background: print the public URL prominently
# the first time it appears, then keep streaming so failures stay visible.
parse_stream() {
  found=0
  tail -n +1 -F "${LOG}" 2>/dev/null | while IFS= read -r line; do
    if [ "${found}" -eq 0 ]; then
      # Take the first https://*.trycloudflare.com on the line, excluding
      # https://api.trycloudflare.com (the Cloudflare API endpoint, which
      # appears in the log banner but is NOT a tunnel URL).
      url="$(printf '%s' "${line}" | grep -o -E 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' | grep -v -x 'https://api\.trycloudflare\.com' | head -n 1 || true)"
      if [ -n "${url}" ]; then
        found=1
        printf '\n================================================================\n'
        printf '  JUDGE ACCESS URL:\n'
        printf '    %s\n' "${url}"
        printf '================================================================\n\n'
        printf 'Next steps:\n'
        printf '  1. Make sure RingFlow is running:  npm run start   (port %s)\n' "${PORT}"
        printf '  2. In RingFlow, go to Settings -> Judge access URL and paste:\n'
        printf '       %s\n' "${url}"
        printf '  3. Hit "Test" — it checks the URL reaches THIS server\n'
        printf '     (compares the tunnel /api/health instanceId).\n'
        printf '  4. Share judge join links/QR codes built from that URL.\n\n'
        printf 'Note: staff pages (/admin, /moderator, /organiser, /stager)\n'
        printf 'remain LAN-only — the tunnel exposes /j/* judge pages only.\n\n'
      fi
    fi
    printf '%s\n' "${line}"
  done
}
parse_stream &
PARSER_PID="$!"

# Supervise cloudflared in the foreground. If it exits on its own (bad
# args, network failure, …) stop the parser and end the script instead of
# hanging in `tail -F`.
# NOTE: `kill -0` is NOT used here — it reports success for zombie
# children, so a dead-but-unreaped cloudflared would look alive forever.
# `ps` state "Z" (or no such pid) is the reliable signal, on macOS and Linux.
# The `|| true` keeps `set -e -o pipefail` from killing the script when ps
# itself errors (pid already gone).
while :; do
  state="$(ps -o stat= -p "${CLOUDFLARED_PID}" 2>/dev/null | tr -d '[:space:]' || true)"
  case "${state}" in
    ""|Z*) break ;;
  esac
  sleep 1
done

# Tunnel ended on its own (Ctrl+C exits earlier via the INT trap).
kill_tree
wait "${CLOUDFLARED_PID}" 2>/dev/null || true # reap
say ""
say "Tunnel process ended — see the log output above."
