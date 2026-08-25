#!/usr/bin/env bash
set -euo pipefail

AGENT_SERVICE_URL="${AGENT_SERVICE_URL:-http://localhost:4000}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"

echo "==> Testing Agent Service Health Endpoint..."
curl -fsS "${AGENT_SERVICE_URL}/health" | grep -q "ok" && echo "✅ Agent Service: HEALTHY" || { echo "❌ Agent Service: UNHEALTHY"; exit 1; }

echo "==> Testing Agent Service Readiness Endpoint..."
curl -fsS "${AGENT_SERVICE_URL}/ready" | grep -q "ready" && echo "✅ Agent Service: READY" || { echo "❌ Agent Service: NOT READY"; exit 1; }

echo "==> Testing Agent Service Agents List API..."
curl -fsS "${AGENT_SERVICE_URL}/api/v1/agents" | grep -q "chief" && echo "✅ Agent Service Agents API: OPERATIONAL" || { echo "❌ Agents API: FAILED"; exit 1; }

echo "==> Testing Dashboard Endpoint..."
curl -fsS "${DASHBOARD_URL}" > /dev/null && echo "✅ Dashboard: ACCESSIBLE" || { echo "❌ Dashboard: UNREACHABLE"; exit 1; }

echo "============================================="
echo "🎉 ALL ATLAS AI OS SERVICES OPERATIONAL!"
echo "============================================="
