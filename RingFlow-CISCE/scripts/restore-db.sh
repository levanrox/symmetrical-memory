#!/bin/sh
# RingFlow database restore.
#
# Restores a pg_dump custom-format backup (made by scripts/backup-db.sh)
# into the compose `db` service. Stops app/realtime first so nothing writes
# mid-restore, then restores with pg_restore --clean.
#
# Usage:
#   ./scripts/restore-db.sh ./backups/ringflow-2026-09-21T080000.dump
#   ./scripts/restore-db.sh --yes ./backups/ringflow-2026-09-21T080000.dump  # skip prompt
#
# Run from the RingFlow-CISCE repo root. DESTRUCTIVE: current DB data is replaced.

set -eu

cd "$(dirname "$0")/.."

SKIP_CONFIRM=0
BACKUP=""

for arg in "$@"; do
  case "$arg" in
    --yes) SKIP_CONFIRM=1 ;;
    -h|--help)
      echo "Usage: $0 [--yes] <backup-file.dump>"
      exit 0
      ;;
    *) BACKUP="$arg" ;;
  esac
done

if [ -z "$BACKUP" ]; then
  echo "error: no backup file given. Usage: $0 [--yes] <backup-file.dump>" >&2
  exit 1
fi
if [ ! -f "$BACKUP" ]; then
  echo "error: backup file not found: $BACKUP" >&2
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-event_suite}"
POSTGRES_DB="${POSTGRES_DB:-ringflow}"

echo "This will REPLACE the current '$POSTGRES_DB' database with:"
echo "  $BACKUP"
if [ "$SKIP_CONFIRM" -eq 0 ]; then
  printf "Type RESTORE to continue: "
  read -r CONFIRM
  if [ "$CONFIRM" != "RESTORE" ]; then
    echo "Aborted."
    exit 0
  fi
fi

if ! docker compose ps --status running db 2>/dev/null | grep -q .; then
  echo "error: the 'db' service is not running. Start it first: docker compose up -d db" >&2
  exit 1
fi

echo "Stopping app and realtime so nothing writes during the restore ..."
docker compose stop app realtime 2>/dev/null || true

CONTAINER_ID="$(docker compose ps -q db)"
echo "Copying backup into the db container ..."
docker cp "$BACKUP" "$CONTAINER_ID:/tmp/ringflow-restore.dump"

echo "Restoring ..."
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/ringflow-restore.dump
docker compose exec -T db rm -f /tmp/ringflow-restore.dump

echo "Restore finished. Verifying ..."
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema='public';"

echo ""
echo "Next steps:"
echo "  1. docker compose up -d app realtime"
echo "  2. curl -sf http://localhost:3000/api/health && echo HEALTHY"
echo "  3. Spot-check a few pages (dashboard, a ring display) before resuming the event."
