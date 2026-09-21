#!/bin/sh
# RingFlow database backup.
#
# Dumps the ringflow Postgres DB (via the compose `db` service) to a
# timestamped custom-format pg_dump file under ./backups/, and prunes old
# backups (keep BACKUP_KEEP, default 10).
#
# Usage:
#   ./scripts/backup-db.sh
#   BACKUP_KEEP=20 ./scripts/backup-db.sh
#
# Run from the RingFlow-CISCE repo root.

set -eu

cd "$(dirname "$0")/.."

POSTGRES_USER="${POSTGRES_USER:-event_suite}"
POSTGRES_DB="${POSTGRES_DB:-ringflow}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%dT%H%M%S)"
OUT="$BACKUP_DIR/ringflow-$STAMP.dump"

if ! docker compose ps --status running db 2>/dev/null | grep -q .; then
  echo "error: the 'db' service is not running. Start it first: docker compose up -d db" >&2
  exit 1
fi

echo "Backing up database '$POSTGRES_DB' -> $OUT ..."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "/tmp/ringflow-backup.dump"
# Copy out of the container (keeps the dump portable even if the volume moves).
CONTAINER_ID="$(docker compose ps -q db)"
docker cp "$CONTAINER_ID:/tmp/ringflow-backup.dump" "$OUT"
docker compose exec -T db rm -f /tmp/ringflow-backup.dump

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Backup complete: $OUT ($SIZE)"

# Prune old backups, keep the newest $BACKUP_KEEP.
COUNT="$(ls -1 "$BACKUP_DIR"/ringflow-*.dump 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$BACKUP_KEEP" ]; then
  REMOVE=$((COUNT - BACKUP_KEEP))
  echo "Pruning $REMOVE old backup(s), keeping the newest $BACKUP_KEEP ..."
  ls -1 "$BACKUP_DIR"/ringflow-*.dump | sort | head -n "$REMOVE" | xargs rm -f
fi

echo "Done. $(ls -1 "$BACKUP_DIR"/ringflow-*.dump | wc -l | tr -d ' ') backup(s) in $BACKUP_DIR."
echo "Tip: copy the newest file off this machine (USB stick is fine) before the event."
