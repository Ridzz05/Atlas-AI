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
# Caddy gates the whole site with HTTP basic auth because the dashboard proxy injects the
# real API bearer token. These CI fixtures are public values, not secrets. Assigned
# separately because a bcrypt hash contains `$`, which must not be re-expanded.
: "${ATLAS_BASIC_AUTH_USER:=ci-operator}"
: "${ATLAS_BASIC_AUTH_PASSWORD:=ci-dashboard-basic-auth}"
if [[ -z "${ATLAS_BASIC_AUTH_HASH:-}" ]]; then
  ATLAS_BASIC_AUTH_HASH='$2b$10$.N7ued2ENxJveCUeoXijCufvA3w0bPhvs90bIpR6UBohBG53l9PMy'
fi
export POSTGRES_PASSWORD REDIS_PASSWORD API_AUTH_TOKEN ENCRYPTION_KEY
export TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_USER_IDS MODEL_PROVIDER MODEL_API_KEY MODEL_BASE_URL MODEL_NAME ATLAS_DOMAIN
export ATLAS_BASIC_AUTH_USER ATLAS_BASIC_AUTH_HASH

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

assert_task_intake_persistence() {
  local task_id=""
  local message_result=""

  task_id="$("${COMPOSE[@]}" exec -T agent-service node -e "fetch('http://127.0.0.1:4000/api/v1/tasks', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.API_AUTH_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'CI intake persistence', goal: 'CI intake persistence check', assignedAgent: 'chief' }) }).then(async response => { if (response.status !== 201) { console.error(await response.text()); process.exit(1); } const task = await response.json(); process.stdout.write(task.id); }).catch(error => { console.error(error); process.exit(1); });")"
  if [[ ! "$task_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    echo "API task intake returned an invalid task id: ${task_id}" >&2
    return 1
  fi

  message_result="$("${COMPOSE[@]}" exec -T -e "CI_INTAKE_TASK_ID=${task_id}" agent-service node -e "const taskId = process.env.CI_INTAKE_TASK_ID; fetch('http://127.0.0.1:4000/api/v1/messages?taskId=' + encodeURIComponent(taskId), { headers: { authorization: 'Bearer ' + process.env.API_AUTH_TOKEN } }).then(async response => { const body = await response.json().catch(() => ({})); const found = response.ok && body.durable === true && Array.isArray(body.data) && body.data.some(message => message.senderId === 'api-owner' && message.content === 'CI intake persistence check'); if (!found) { console.error('Durable task intake message assertion failed:', response.status, JSON.stringify(body)); process.exit(1); } process.stdout.write('ok'); }).catch(error => { console.error(error); process.exit(1); });")"
  if [[ "$message_result" != "ok" ]]; then
    echo "Durable task intake message assertion returned: ${message_result}" >&2
    return 1
  fi
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

assert_dashboard_proxy() {
  local caddy_host="${ATLAS_DOMAIN}:443:127.0.0.1"
  local basic_auth="${ATLAS_BASIC_AUTH_USER}:${ATLAS_BASIC_AUTH_PASSWORD}"

  # The gate must reject anonymous access, and /health must stay reachable without it so
  # container healthchecks keep working.
  local anonymous_status
  anonymous_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --insecure --max-time 10 --resolve "$caddy_host" "https://${ATLAS_DOMAIN}/")"
  if [[ "$anonymous_status" != "401" ]]; then
    echo "Caddy access gate did not reject an anonymous dashboard request (status ${anonymous_status})" >&2
    return 1
  fi
  curl --fail --silent --show-error --insecure --max-time 10 --resolve "$caddy_host" "https://${ATLAS_DOMAIN}/health" >/dev/null

  curl --fail --silent --show-error --user "$basic_auth" --insecure --max-time 10 --resolve "$caddy_host" "https://${ATLAS_DOMAIN}/api/atlas/tasks?limit=1" >/dev/null

  local stream_headers=""
  local stream_status=0
  stream_headers="$(mktemp)"
  set +e
  curl --silent --user "$basic_auth" --insecure --max-time 5 --dump-header "$stream_headers" --output /dev/null --resolve "$caddy_host" "https://${ATLAS_DOMAIN}/api/atlas/events/stream"
  stream_status=$?
  set -e
  if [[ "$stream_status" -ne 0 && "$stream_status" -ne 28 ]]; then
    cat "$stream_headers"
    rm -f "$stream_headers"
    echo "Dashboard SSE proxy request failed with curl status: ${stream_status}" >&2
    return 1
  fi
  if ! grep -qi '^content-type: text/event-stream' "$stream_headers"; then
    cat "$stream_headers"
    rm -f "$stream_headers"
    echo "Dashboard SSE proxy did not return an event-stream content type." >&2
    return 1
  fi
  rm -f "$stream_headers"
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
echo "==> Verifying durable API task intake history..."
assert_task_intake_persistence

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
# The seeder upserts defaultAgentRegistry.list(), which has one entry per file in
# packages/agents/src/definitions. Deriving the expectation from there keeps this
# assertion from drifting every time the fleet changes (it previously hardcoded 5 while
# the registry had 9). packages/agents/test/agents.test.ts pins the two together.
expected_agent_count="$(find packages/agents/src/definitions -maxdepth 1 -name '*.ts' | wc -l | tr -d '[:space:]')"
if [[ -z "$expected_agent_count" || "$expected_agent_count" == "0" ]]; then
  echo "Could not determine the expected agent count from packages/agents/src/definitions" >&2
  exit 1
fi
if [[ "$agent_count" != "$expected_agent_count" ]]; then
  echo "Expected $expected_agent_count seeded agents, found: $agent_count" >&2
  exit 1
fi

echo "==> Verifying the migration chain applied in full..."
applied_migrations="$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "${POSTGRES_DB:-atlas_os}" -Atqc "SELECT count(*) FROM schema_migrations;" | tr -d '[:space:]')"
# One version row per file in packages/database/src/migrations. A migration that aborts the chain
# leaves the later files unapplied, and the service still boots on the tables it needs — so the
# count is the assertion that catches a partial chain rather than a missing table.
expected_migrations="$(find packages/database/src/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d '[:space:]')"
if [[ -z "$expected_migrations" || "$expected_migrations" == "0" ]]; then
  echo "Could not determine the expected migration count from packages/database/src/migrations" >&2
  exit 1
fi
if [[ "$applied_migrations" != "$expected_migrations" ]]; then
  echo "Expected $expected_migrations applied migrations, found: $applied_migrations" >&2
  exit 1
fi

echo "==> Starting Telegram bot and verifying service readiness..."
"${COMPOSE[@]}" up -d telegram-bot
wait_for_health telegram-bot
assert_ready telegram-bot http://127.0.0.1:8082/ready

echo "==> Starting dashboard and Caddy..."
"${COMPOSE[@]}" up -d dashboard caddy
wait_for_health dashboard
wait_for_health caddy
curl --fail --silent --show-error -H "Host: ${ATLAS_DOMAIN}" http://127.0.0.1/health >/dev/null
curl --fail --silent --show-error --user "${ATLAS_BASIC_AUTH_USER}:${ATLAS_BASIC_AUTH_PASSWORD}" -H "Host: ${ATLAS_DOMAIN}" http://127.0.0.1/ >/dev/null
echo "==> Verifying dashboard task and SSE proxy routes..."
assert_dashboard_proxy

echo "==> Verifying PostgreSQL backup and restore..."
CI_BACKUP_FILE="$(mktemp)"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "${POSTGRES_USER:-atlas_admin}" -d "${POSTGRES_DB:-atlas_os}" | gzip > "$CI_BACKUP_FILE"
restore_db="atlas_restore_check"
"${COMPOSE[@]}" exec -T postgres dropdb --if-exists -U "${POSTGRES_USER:-atlas_admin}" "$restore_db"
"${COMPOSE[@]}" exec -T postgres createdb -U "${POSTGRES_USER:-atlas_admin}" "$restore_db"
gunzip -c "$CI_BACKUP_FILE" | "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "$restore_db" -v ON_ERROR_STOP=1 >/dev/null
restored_agent_count="$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER:-atlas_admin}" -d "$restore_db" -Atqc "SELECT count(*) FROM agents;" | tr -d '[:space:]')"
if [[ "$restored_agent_count" != "$expected_agent_count" ]]; then
  echo "Expected $expected_agent_count restored agents, found: $restored_agent_count" >&2
  exit 1
fi
"${COMPOSE[@]}" exec -T postgres dropdb -U "${POSTGRES_USER:-atlas_admin}" "$restore_db"

echo "==> Compose smoke and backup/restore verification passed."
