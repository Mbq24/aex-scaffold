/**
 * demo.ts — Runs a season of tasks through the AEX scaffold and prints results.
 *
 * Usage: bun run src/demo.ts
 *
 * This demo:
 *  1. Creates 8 agents with varied skill levels
 *  2. Runs 15 tasks of increasing complexity
 *  3. For each task: proposes DAGs, prices them via LMSR, picks the best,
 *     simulates execution, verifies the outcome, updates reputation
 *  4. Prints a table showing what the market predicted vs what actually happened
 *
 * The output demonstrates:
 *  - LMSR market calibration (does the price match reality?)
 *  - Reputation convergence (do skilled agents rise to the top?)
 *  - Strategy selection (which DAG structure performs best for each task type?)
 */

import { ScaffoldEngine } from "./engine";
import { createDemoAgents } from "./reputation";
import type { Task } from "./types";

// ── Configuration ──────────────────────────────────────────

const SEED = 42;
const AGENT_COUNT = 12;
const TASK_COUNT = 15;

// ── Create agents ─────────────────────────────────────────

const agents = createDemoAgents(AGENT_COUNT);

// ── Define tasks ──────────────────────────────────────────

const taskTemplates: Array<{
  goal: string;
  budget: number;
  value: number;
  latencyTarget: Task["latencyTarget"];
  verificationLevel: Task["verificationLevel"];
}> = [
  // Simple, fast tasks
  { goal: "Fetch BTC price from Coinbase", budget: 50, value: 200, latencyTarget: "fast", verificationLevel: "lenient" },
  { goal: "Check ETH gas price", budget: 30, value: 150, latencyTarget: "fast", verificationLevel: "lenient" },
  { goal: "Get current USD/EUR rate", budget: 40, value: 180, latencyTarget: "fast", verificationLevel: "lenient" },

  // Medium complexity
  { goal: "Deploy an ERC-20 token contract", budget: 200, value: 800, latencyTarget: "normal", verificationLevel: "standard" },
  { goal: "Build a simple price alert bot", budget: 250, value: 900, latencyTarget: "normal", verificationLevel: "standard" },
  { goal: "Create a Uniswap V3 position tracker", budget: 300, value: 1000, latencyTarget: "normal", verificationLevel: "standard" },
  { goal: "Write a DCA strategy for ETH", budget: 350, value: 1200, latencyTarget: "normal", verificationLevel: "standard" },

  // Complex, high-value
  { goal: "Audit a 500-line Solidity contract", budget: 500, value: 2500, latencyTarget: "batch", verificationLevel: "strict" },
  { goal: "Build a cross-chain bridge monitor", budget: 600, value: 3000, latencyTarget: "batch", verificationLevel: "strict" },
  { goal: "Design a yield optimization strategy", budget: 700, value: 3500, latencyTarget: "batch", verificationLevel: "strict" },
  { goal: "Implement a MEV protection system", budget: 800, value: 4000, latencyTarget: "batch", verificationLevel: "strict" },

  // Mixed for the remaining tasks
  { goal: "Generate a daily market report", budget: 150, value: 600, latencyTarget: "normal", verificationLevel: "standard" },
  { goal: "Calculate impermanent loss for a LP position", budget: 100, value: 500, latencyTarget: "fast", verificationLevel: "lenient" },
  { goal: "Build a liquidation price calculator", budget: 200, value: 750, latencyTarget: "normal", verificationLevel: "standard" },
  { goal: "Create a portfolio rebalancing script", budget: 400, value: 2000, latencyTarget: "batch", verificationLevel: "standard" },
];

const tasks: Task[] = [];
for (let i = 0; i < Math.min(TASK_COUNT, taskTemplates.length); i++) {
  const t = taskTemplates[i];
  tasks.push({
    id: `task-${i}`,
    goal: t.goal,
    budget: t.budget,
    value: t.value,
    latencyTarget: t.latencyTarget,
    verificationLevel: t.verificationLevel,
  });
}

// ── Run the season ────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║           AEX Scaffold — Season Demo                       ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

console.log(`Agents:      ${AGENT_COUNT}`);
console.log(`Tasks:       ${tasks.length}`);
console.log(`Random seed: ${SEED}\n`);

const engine = new ScaffoldEngine(agents, SEED);
const { results, agents: finalAgents } = engine.runSeason(tasks);

// ── Print per-task results ────────────────────────────────

console.log(`\n─── Per-Task Results ───────────────────────────────────────\n`);

for (const r of results) {
  const price = r.prices.get(r.winnerId) ?? 0.5;
  const actual = r.completed ? 1 : 0;
  const statusIcon = r.completed ? "✅" : "❌";
  const winnerDag = r.dags.find((d) => d.id === r.winnerId);
  const strategy = winnerDag?.strategy ?? "?";

  console.log(
    `  ${statusIcon} ${r.task.id.padEnd(8)} ` +
    `P=${(price * 100).toFixed(0).padStart(3)}% ` +
    `EV=$${r.winnerEV.toFixed(0).padStart(5)} ` +
    `actual=${actual === 1 ? "PASS" : "FAIL".padEnd(4)} ` +
    `strategy=${strategy.padEnd(15)} ` +
    `cal=${r.calibrationError.toFixed(3)}`
  );
}

// ── Summary stats ─────────────────────────────────────────

// Brier Score: Mean Squared Error of probabilistic predictions
// 0 = perfect, 0.25 = always predicting 50/50, higher = worse
const brierScore = results.reduce((sum, r) => {
  const price = r.prices.get(r.winnerId) ?? 0.5;
  const actual = r.completed ? 1 : 0;
  return sum + (price - actual) ** 2;
}, 0) / results.length;

// Directional accuracy: did higher-priced DAGs succeed more often?
const highPrice = results.filter((r) => (r.prices.get(r.winnerId) ?? 0.5) >= 0.45);
const lowPrice = results.filter((r) => (r.prices.get(r.winnerId) ?? 0.5) < 0.45);
const highWinRate = highPrice.length > 0 ? highPrice.filter((r) => r.completed).length / highPrice.length : 0;
const lowWinRate = lowPrice.length > 0 ? lowPrice.filter((r) => r.completed).length / lowPrice.length : 0;

console.log("\n─── Summary ────────────────────────────────────────────────\n");
console.log(`  Brier Score (0=perfect, 0.25=random): ${brierScore.toFixed(4)}`);
console.log(`  Market spread:                       ${(highWinRate * 100).toFixed(0)}% win rate ≥45% vs ${(lowWinRate * 100).toFixed(0)}% win rate <45%`);
console.log(`  Calibration trend:                   ${highWinRate > lowWinRate ? "✅ Higher price = higher success rate" : "🔄 No clear trend (needs more tasks)"}`);
console.log(`  Tasks:                               ${results.length}`);

// ── Final agent rankings ───────────────────────────────────

console.log("\n─── Agent Rankings (final) ─────────────────────────────────\n");
console.log(`  ${"Rank".padEnd(6)} ${"Agent".padEnd(20)} ${"Skill".padEnd(8)} ${"Rep".padEnd(8)} ${"Jobs".padEnd(6)}`);
console.log(`  ${"─".repeat(6)} ${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(6)}`);

const sorted = [...finalAgents].sort((a, b) => b.reputation - a.reputation || b.skill - a.skill);
sorted.forEach((a, i) => {
  const skillBar = bar(a.skill, 8);
  const repBar = bar(a.reputation, 8);
  console.log(
    `  #${(i + 1).toString().padEnd(4)} ` +
    `${a.id.padEnd(20)} ` +
    `${(a.skill * 100).toFixed(0).padStart(3)}%${skillBar} ` +
    `${(a.reputation * 100).toFixed(0).padStart(3)}%${repBar} ` +
    `${a.jobs}`
  );
});

// ── Verification: do skilled agents rise to the top? ──────

const top3 = sorted.slice(0, 3);
const bottom3 = sorted.slice(-3);
const topSkill = top3.reduce((s, a) => s + a.skill, 0) / top3.length;
const bottomSkill = bottom3.reduce((s, a) => s + a.skill, 0) / bottom3.length;

console.log(`\n  Top 3 avg skill:   ${(topSkill * 100).toFixed(1)}%`);
console.log(`  Bottom 3 avg skill: ${(bottomSkill * 100).toFixed(1)}%`);
console.log(`  Skills differentiated: ${topSkill > bottomSkill ? "✅ Yes" : "❌ No (needs more tasks)"}`);

// ── Bonus: show best strategy ─────────────────────────────

const strategyStats = new Map<string, { wins: number; total: number }>();
for (const r of results) {
  const d = r.dags.find((dag) => dag.id === r.winnerId);
  const s = d?.strategy ?? "unknown";
  const stat = strategyStats.get(s) ?? { wins: 0, total: 0 };
  stat.total++;
  if (r.completed) stat.wins++;
  strategyStats.set(s, stat);
}

console.log("\n─── Strategy Performance ───────────────────────────────────\n");
for (const [strategy, stat] of Array.from(strategyStats.entries())) {
  const wr = stat.total > 0 ? (stat.wins / stat.total * 100).toFixed(0) : "-";
  const barStr = stat.total > 0 ? bar(stat.wins / stat.total, 10) : "  ";
  console.log(`  ${strategy.padEnd(16)} ${stat.wins}/${stat.total} wins  ${wr.padStart(3)}%${barStr}`);
}

console.log("");

// ── Helpers ───────────────────────────────────────────────

function bar(value: number, width: number): string {
  const filled = Math.round(value * width);
  return " " + "█".repeat(Math.max(0, filled)).padEnd(width, "░");
}
