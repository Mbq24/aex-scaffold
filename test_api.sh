#!/usr/bin/env bash
# Full API lifecycle test for AEX Scaffold
set -euo pipefail
BASE="${1:-http://localhost:8081}"

echo "═══ 1. Register fresh agents ═══"
curl -s -X POST "$BASE/agents/register" -H "Content-Type: application/json" -d '{"id":"agent-a","skill":0.85}'
echo ""
curl -s -X POST "$BASE/agents/register" -H "Content-Type: application/json" -d '{"id":"agent-b","skill":0.70}'
echo ""
curl -s -X POST "$BASE/agents/register" -H "Content-Type: application/json" -d '{"id":"agent-c","skill":0.55}'
echo ""
curl -s -X POST "$BASE/agents/register" -H "Content-Type: application/json" -d '{"id":"agent-d","skill":0.40}'
echo ""

echo ""
echo "═══ 2. List agents ═══"
curl -s "$BASE/agents"
echo ""

echo ""
echo "═══ 3. Submit a task ═══"
TASK_RESP=$(curl -s -X POST "$BASE/tasks" \
  -H "Content-Type: application/json" \
  -d '{"goal":"Build a DCA strategy for ETH","budget":300,"value":1200}')
echo "$TASK_RESP"
echo ""

# Extract taskId
TASK_ID=$(echo "$TASK_RESP" | grep -o '"taskId":"[^"]*"' | cut -d'"' -f4)
echo "Task ID: $TASK_ID"

echo ""
echo "═══ 4. View task state ═══"
curl -s "$BASE/tasks/$TASK_ID"
echo ""

echo ""
echo "═══ 5. Trade on a DAG ═══"
# Get first DAG ID
DAG_LIST=$(curl -s "$BASE/tasks/$TASK_ID")
FIRST_DAG=$(echo "$DAG_LIST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Trading on DAG: $FIRST_DAG"

curl -s -X POST "$BASE/tasks/$TASK_ID/trade" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"agent-a\",\"dagId\":\"$FIRST_DAG\",\"belief\":0.8,\"stake\":50}"
echo ""

curl -s -X POST "$BASE/tasks/$TASK_ID/trade" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"agent-b\",\"dagId\":\"$FIRST_DAG\",\"belief\":0.3,\"stake\":30}"
echo ""

echo ""
echo "═══ 6. Check updated prices ═══"
curl -s "$BASE/tasks/$TASK_ID" | grep -o '"prices":{"[^}]*"}' | head -1
echo ""

echo ""
echo "═══ 7. Resolve the market ═══"
curl -s -X POST "$BASE/tasks/$TASK_ID/resolve" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent-a"}'
echo ""

echo ""
echo "═══ 8. Submit execution result ═══"
curl -s -X POST "$BASE/tasks/$TASK_ID/result" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent-a","success":true}'
echo ""

echo ""
echo "═══ 9. View final state ═══"
curl -s "$BASE/tasks/$TASK_ID"
echo ""

echo ""
echo "═══ 10. Agent reputations ═══"
curl -s "$BASE/agents"
echo ""

echo ""
echo "═══ DONE ═══"
