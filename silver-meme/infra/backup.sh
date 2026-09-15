#!/usr/bin/env bash
#
# Back the tournament database up to a directory — a USB stick, ideally.
#
#   ./infra/backup.sh /media/usb/event-backups
#
# One box is one failure domain: if it dies mid-event, this dump plus a spare
# laptop that can run `pg_restore` is what stands between you and losing the
# day. Run it from cron during an event, every ten minutes or so:
#
#   */10 * * * * /path/to/infra/backup.sh /media/usb/event-backups >> /var/log/event-backup.log 2>&1
#
set -euo pipefail

DESTINATION="${1:-}"
if [[ -z "$DESTINATION" ]]; then
  echo "usage: $0 <destination-directory>" >&2
  exit 2
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Install the postgres client, or run this from the database container:" >&2
  echo "  docker compose exec -T db pg_dump -U event_suite -d event_suite" >&2
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-postgres://event_suite:event_suite@127.0.0.1:5432/event_suite}"
KEEP="${KEEP:-48}"

mkdir -p "$DESTINATION"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$DESTINATION/event-suite-$STAMP.dump"

# Custom format so pg_restore can be selective and parallel later. Written to a
# temporary name first and moved into place, so a dump interrupted by a power
# cut never looks like a complete backup.
pg_dump --format=custom --no-owner --no-privileges --file="$TARGET.partial" "$DATABASE_URL"
mv "$TARGET.partial" "$TARGET"

echo "$(date -Is) wrote $TARGET"

# Keep the newest N dumps; a USB stick filling up mid-event is its own outage.
mapfile -t OLD < <(ls -1t "$DESTINATION"/event-suite-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) || true)
for file in "${OLD[@]:-}"; do
  [[ -n "$file" ]] || continue
  rm -f "$file"
  echo "$(date -Is) pruned $file"
done
