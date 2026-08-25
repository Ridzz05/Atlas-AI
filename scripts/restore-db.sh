#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/restore-db.sh <path_to_backup_file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER_NAME="${CONTAINER_NAME:-atlas_postgres_prod}"
DB_NAME="${POSTGRES_DB:-atlas_os}"
DB_USER="${POSTGRES_USER:-atlas_admin}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file '$BACKUP_FILE' does not exist."
  exit 1
fi

echo "⚠️  WARNING: This will overwrite existing database '${DB_NAME}'!"
read -p "Are you sure you want to proceed? (y/N): " -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Restoration aborted."
  exit 0
fi

echo "==> Restoring from ${BACKUP_FILE}..."
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME"

echo "==> Database restore completed successfully."
