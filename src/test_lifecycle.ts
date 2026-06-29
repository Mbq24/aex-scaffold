/**
 * test_lifecycle.ts — Full API lifecycle test
 *
 * Registers agents, submits a task, trades, resolves,
 * submits outcome, and checks final state.
 *
 * Bun run: bun run src/test_lifecycle.ts
 */

const BASE = "http://localhost:8081";

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function main() {
  console.log("═══ 1. Register agents ═══");
  const agents = [
    { id: "alpha", skill: 0.85 },
    { id: "beta", skill: 0.70 },
    { id: "gamma", skill: 0.55 },
    { id: "delta", skill: 0.40 },
    { id: "epsilon", skill: 0.65 },
    { id: "zeta", skill: 0.50 },
  ];
  for (const a of agents) {
    try {
      const r = await post("/agents/register", a);
      console.log(`  ${r.agent?.id ?? "error"}: skill=${r.agent?.skill ?? r.error}`);
    } catch {
      console.log(`  ${a.id}: skipped (may exist)`);
    }
  }

  console.log("\n═══ 2. List agents ═══");
  const allAgents = await get("/agents");
  for (const a of allAgents) {
    console.log(`  ${a.id.padEnd(10)} skill=${a.skill} rep=${a.reputation} bal=${a.balance}`);
  }

  console.log("\n═══ 3. Submit a task ═══");
  const taskResp = await post("/tasks", {
    goal: "Build a DCA strategy for ETH",
    budget: 300,
    value: 1200,
  });
  console.log(`  taskId: ${taskResp.taskId}`);
  console.log(`  goal:   ${taskResp.task.goal}`);
  for (const dag of taskResp.dags) {
    const cost = dag.nodes.reduce((s: number, n: any) => s + n.cost, 0);
    const p = taskResp.prices[dag.id];
    const ev = Math.round((p * 1200 - cost) * 100) / 100;
    console.log(`  ${dag.strategy.padEnd(12)} P=${(p * 100).toFixed(0)}% EV=\$${ev}`);
  }

  const taskId = taskResp.taskId;
  const dags = taskResp.dags;

  console.log("\n═══ 4. Trade on economy DAG ═══");
  const economyDag = dags.find((d: any) => d.strategy === "economy");
  if (economyDag) {
    const r1 = await post(`/tasks/${taskId}/trade`, {
      agentId: "alpha", dagId: economyDag.id, belief: 0.7, stake: 50,
    });
    console.log(`  alpha trades: dag=${economyDag.strategy} belief=0.7 stake=50 -> newPrice=${r1.newPrice} bal=${r1.remainingBalance}`);

    const r2 = await post(`/tasks/${taskId}/trade`, {
      agentId: "beta", dagId: economyDag.id, belief: 0.3, stake: 30,
    });
    console.log(`  beta  trades: dag=${economyDag.strategy} belief=0.3 stake=30 -> newPrice=${r2.newPrice} bal=${r2.remainingBalance}`);
  }

  console.log("\n═══ 5. Trade on premium DAG ═══");
  const premiumDag = dags.find((d: any) => d.strategy === "premium");
  if (premiumDag) {
    const r3 = await post(`/tasks/${taskId}/trade`, {
      agentId: "gamma", dagId: premiumDag.id, belief: 0.8, stake: 60,
    });
    console.log(`  gamma trades: dag=${premiumDag.strategy} belief=0.8 stake=60 -> newPrice=${r3.newPrice} bal=${r3.remainingBalance}`);

    const r4 = await post(`/tasks/${taskId}/trade`, {
      agentId: "delta", dagId: premiumDag.id, belief: 0.2, stake: 25,
    });
    console.log(`  delta trades: dag=${premiumDag.strategy} belief=0.2 stake=25 -> newPrice=${r4.newPrice} bal=${r4.remainingBalance}`);
  }

  console.log("\n═══ 6. Updated prices ═══");
  const taskState = await get(`/tasks/${taskId}`);
  for (const dag of taskState.dags) {
    const p = taskState.prices[dag.id];
    console.log(`  ${dag.strategy.padEnd(12)} P=${(p * 100).toFixed(1)}% cost=\$${dag.totalCost}`);
  }

  console.log("\n═══ 7. Resolve market ═══");
  const resolveResp = await post(`/tasks/${taskId}/resolve`, { agentId: "alpha" });
  if (resolveResp.winner) {
    console.log(`  Winner: ${resolveResp.winner.strategy} (P=${(resolveResp.winner.pSuccess * 100).toFixed(0)}%, EV=\$${resolveResp.winner.ev})`);
  } else {
    console.log(`  Error: ${JSON.stringify(resolveResp)}`);
  }

  console.log("\n═══ 8. Submit execution result ═══");
  const resultResp = await post(`/tasks/${taskId}/result`, {
    agentId: "alpha",
    success: true,
  });
  console.log(`  Outcome: ${resultResp.completed ? "PASS ✅" : "FAIL ❌"} score=${resultResp.outcomeScore}`);
  console.log(`  Winning DAG: ${resultResp.winningDag}`);
  for (const r of resultResp.reputations ?? []) {
    console.log(`  Rep: ${r.agentId.padEnd(10)} ${r.oldRep} -> ${r.newRep} (${r.change})`);
  }

  console.log("\n═══ 9. Final agent states ═══");
  const finalAgents = await get("/agents");
  const sorted = [...finalAgents].sort((a: any, b: any) => b.reputation - a.reputation);
  for (const a of sorted) {
    console.log(`  ${a.id.padEnd(10)} skill=${a.skill} rep=${a.reputation} jobs=${a.jobs} bal=${a.balance}`);
  }

  console.log("\n═══ DONE ═══");
}

main().catch(console.error);
