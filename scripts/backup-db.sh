#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="atlas_db_backup_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"
TEMP_BACKUP_PATH=""
CONTAINER_NAME="${CONTAINER_NAME:-${ATLAS_CONTAINER_PREFIX:-atlas}_postgres_prod}"
DB_NAME="${POSTGRES_DB:-atlas_os}"
DB_USER="${POSTGRES_USER:-atlas_admin}"

mkdir -p "$BACKUP_DIR"
TEMP_BACKUP_PATH="$(mktemp "${BACKUP_DIR}/.${FILENAME}.tmp.XXXXXX")"
cleanup() {
  if [[ -n "$TEMP_BACKUP_PATH" ]]; then
    rm -f "$TEMP_BACKUP_PATH"
  fi
}
trap cleanup EXIT

echo "==> Starting PostgreSQL backup: ${FILENAME}..."
# Do not allocate a TTY: pg_dump output is a byte stream and must remain intact.
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$TEMP_BACKUP_PATH"
if [[ ! -s "$TEMP_BACKUP_PATH" ]] || ! gzip -t "$TEMP_BACKUP_PATH"; then
  echo "Error: PostgreSQL backup verification failed." >&2
  exit 1
fi
mv -f "$TEMP_BACKUP_PATH" "$BACKUP_PATH"

echo "==> Backup completed successfully: ${BACKUP_PATH} ($(du -h "$BACKUP_PATH" | cut -f1))"

# Keep last 14 days of backups
echo "==> Cleaning up backups older than 14 days..."
find "$BACKUP_DIR" -type f -name "atlas_db_backup_*.sql.gz" -mtime +14 -delete
echo "==> Done."
