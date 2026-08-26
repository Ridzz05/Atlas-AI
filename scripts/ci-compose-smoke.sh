#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-atlas-ci}"
ATLAS_CONTAINER_PREFIX="${ATLAS_CONTAINER_PREFIX:-${COMPOSE_PROJECT_NAME}}"
export COMPOSE_PROJECT_NAME
export ATLAS_CONTAINER_PREFIX

: "${POSTGRES_PASSWORD:=ci-postgres-password}"
: "${REDIS_PASSWORD:=ci-redis-password}"
: "${API_AUTH_TOKEN:=ci-api-auth-token-32-characters-long}"
: "${ENCRYPTION_KEY:=ci-encryption-key-32-characters-long}"
: "${TELEGRAM_BOT_TOKEN:=ci-telegram-token}"
: "${TELEGRAM_ALLOWED_USER_IDS:=1}"
: "${MODEL_PROVIDER:=ollama}"
: "${MODEL_API_KEY:=}"
: "${MODEL_BASE_URL:=http://127.0.0.1:9/v1}"
: "${MODEL_NAME:=ci-smoke}"
: "${ATLAS_DOMAIN:=localhost}"
export POSTGRES_PASSWORD REDIS_PASSWORD API_AUTH_TOKEN ENCRYPTION_KEY
export TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_IDS MODEL_PROVIDER MODEL_API_KEY MODEL_BASE_URL MODEL_NAME ATLAS_DOMAIN

COMPOSE=(docker compose -f "$COMPOSE_FILE")
CI_BACKUP_FILE=""

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  if [[ -n "$CI_BACKUP_FILE" ]]; then
    rm -f "$CI_BACKUP_FILE"
  fi
}
trap cleanup EXIT

wait_for_health() {
  local service="$1"
  local container_id=""
  local status=""

  for _ in $(seq 1 60); do
    container_id="$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      case "$status" in
        healthy)
          echo "$service: healthy"
          return 0
          ;;
        unhealthy)
          "${COMPOSE[@]}" logs "$service"
          echo "$service: unhealthy" >&2
          return 1
          ;;
      esac
    fi
    sleep 5
  done

  "${COMPOSE[@]}" logs "$service" || true
  echo "$service: timed out waiting for a healthy container" >&2
  return 1
}

assert_ready() {
  local service="$1"
  local endpoint="$2"
  "${COMPOSE[@]}" exec -T "$service" node -e "fetch('${endpoint}').then(async response => { if (!response.ok) { console.error(await response.text()); process.exit(1); } }).catch(error => { console.error(error); process.exit(1); });"
}

assert_api_authentication() {
  "${COMPOSE[@]}" exec -T agent-service node -e "Promise.all([fetch('http://127.0.0.1:4000/api/v1/agents'), fetch('http://127.0.0.1:4000/api/v1/agents', { headers: { authorization: 'Bearer ' + process.env.API_AUTH_TOKEN } })]).then(async ([unauthorized, authorized]) => { if (unauthorized.status !== 401 || !authorized.ok) { console.error('API authentication assertion failed:', unauthorized.status, authorized.status, await unauthorized.text(), await authorized.text()); process.exit(1); } }).catch(error => { console.error(error); process.exit(1); });"
}

assert_task_recovered() {
  local task_id="$1"
  local status=""

  for _ in $(seq 1 60); do
    status="$("${COMPOSE[@]}" exec -T agent-service node -e "fetch('http://127.0.0.1:4000/api/v1/tasks/${task_id}', { headers: { authorization: 'Bearer ' + process.env.API_AUTH_TOKEN } }).then(async response => { if (!response.ok) { console.error(await response.text()); process.exit(1); } const task = await response.json(); process.stdout.write(task.status); }).catch(error => { console.error(error); process.exit(1); });")"
    if [[ "$status" != "queued" ]]; then
      echo "queued task ${task_id} recovered with status: ${status}"
      return 0
    fi
    sleep 1
  done

  echo "queued task ${task_id} was not recovered by the worker" >&2
  return 1
}

echo "==> Building application images used by the smoke test..."
"${COMPOSE[@]}" build agent-service worker telegram-bot dashboard

echo "==> Starting PostgreSQL, Redis, and agent-service..."
"${COMPOSE[@]}" up -d postgres redis agent-service
wait_for_health postgres
wait_for_health redis
wait_for_health agent-service
assert_ready agent-service http://127.0.0.1:4000/ready
assert_api_authentication

echo "==> Verifying recovery of a durable queued task before worker startup..."
recovery_task_id="00000000-0000-4000-8000-000000000001"
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "${POSTGRES_DB:-atlas_os}" -v ON_ERROR_STOP=1 -c "INSERT INTO tasks (id, title, goal, assigned_agent, status) VALUES ('${recovery_task_id}', 'CI queued recovery', 'CI queued task recovery check', 'ned', 'queued');" >/dev/null

echo "==> Starting worker and verifying queued-task recovery..."
"${COMPOSE[@]}" up -d worker
wait_for_health worker
assert_ready worker http://127.0.0.1:8081/ready
assert_task_recovered "$recovery_task_id"

echo "==> Verifying service restart readiness..."
"${COMPOSE[@]}" restart agent-service worker
wait_for_health agent-service
wait_for_health worker
assert_ready agent-service http://127.0.0.1:4000/ready
assert_ready worker http://127.0.0.1:8081/ready

agent_count="$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "${POSTGRES_DB:-atlas_os}" -Atqc "SELECT count(*) FROM agents;" | tr -d '[:space:]')"
if [[ "$agent_count" != "5" ]]; then
  echo "Expected 5 seeded agents, found: $agent_count" >&2
  exit 1
fi

echo "==> Starting dashboard and Caddy..."
"${COMPOSE[@]}" up -d dashboard caddy
wait_for_health dashboard
wait_for_health caddy
curl --fail --silent --show-error -H "Host: ${ATLAS_DOMAIN}" http://127.0.0.1/health >/dev/null
curl --fail --silent --show-error -H "Host: ${ATLAS_DOMAIN}" http://127.0.0.1/ >/dev/null

echo "==> Verifying PostgreSQL backup and restore..."
CI_BACKUP_FILE="$(mktemp)"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "${POSTGRES_USER:-atlas_admin}" -d "${POSTGRES_DB:-atlas_os}" | gzip > "$CI_BACKUP_FILE"
restore_db="atlas_restore_check"
"${COMPOSE[@]}" exec -T postgres dropdb --if-exists -U "${POSTGRES_USER:-atlas_admin}" "$restore_db"
"${COMPOSE[@]}" exec -T postgres createdb -U "${POSTGRES_USER:-atlas_admin}" "$restore_db"
gunzip -c "$CI_BACKUP_FILE" | "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "$restore_db" -v ON_ERROR_STOP=1 >/dev/null
restored_agent_count="$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "$restore_db" -Atqc "SELECT count(*) FROM agents;" | tr -d '[:space:]')"
if [[ "$restored_agent_count" != "5" ]]; then
  echo "Expected 5 restored agents, found: $restored_agent_count" >&2
  exit 1
fi
"${COMPOSE[@]}" exec -T postgres dropdb -U "${POSTGRES_USER:-atlas_admin}" "$restore_db"

echo "==> Compose smoke and backup/restore verification passed."
