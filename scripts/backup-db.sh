#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="atlas_db_backup_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="${CONTAINER_NAME:-atlas_postgres_prod}"
DB_NAME="${POSTGRES_DB:-atlas_os}"
DB_USER="${POSTGRES_USER:-atlas_admin}"

mkdir -p "$BACKUP_DIR"

echo "==> Starting PostgreSQL backup: ${FILENAME}..."
docker exec -t "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "==> Backup completed successfully: ${BACKUP_DIR}/${FILENAME} ($(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1))"

# Keep last 14 days of backups
echo "==> Cleaning up backups older than 14 days..."
find "$BACKUP_DIR" -type f -name "atlas_db_backup_*.sql.gz" -mtime +14 -delete
echo "==> Done."
