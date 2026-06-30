/**
 * server.ts — AEX Scaffold API Server
 *
 * A live HTTP server that external agents can call to:
 *  - Register as an agent
 *  - Submit tasks (protocol auto-generates DAG strategies)
 *  - Trade on DAG success probabilities (LMSR market)
 *  - Resolve markets and submit execution outcomes
 *  - Check reputation and agent rankings
 *
 * Zero dependencies — runs on Bun's native HTTP server.
 * Start: bun run src/server.ts
 */

import { LMSRMarket } from "./lmsr";
import { generateDAGs } from "./dags";
import { verify, isCompleted } from "./verifier";
import { updateReputation } from "./reputation";
import type { Agent, DAG, Task, TaskResult, VerificationClass, Bond } from "./types";
import { ADMITTED_CLASSES } from "./types";
import {
  initDB, saveAgent, getAgent, getAllAgents, agentExists,
  saveTask, getTask as getTaskFromDB, getAllTasks,
  type StoredAgent,
} from "./db";

// ── In-memory state ───────────────────────────────────────

interface TaskRecord {
  id: string;
  task: Task;
  status: "open" | "priced" | "executed" | "settled";
  dags: DAG[];
  winnerId: string | null;
  winnerEV: number | null;
  market: LMSRMarket;
  outcomeScore: number | null;
  completed: boolean | null;
  proposerBalances: Map<string, number>;
  bonds: Bond[];
}

const agents = new Map<string, StoredAgent>();
const tasks = new Map<string, TaskRecord>();
let taskSeq = 0;
let rngState = Date.now();

function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function error(msg: string, status: number = 400): Response {
  return json({ error: msg }, status);
}

// ── Routes ─────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  try {
    // ── POST /agents/register ───────────────────────────────
    if (method === "POST" && path === "/agents/register") {
      const body = await req.json() as { id: string; skill?: number };
      if (!body.id) return error("id is required");
      if (agents.has(body.id)) return error("agent already exists");

      const skill = body.skill ?? Math.round((0.3 + rand() * 0.6) * 100) / 100;
      const agent: StoredAgent = {
        id: body.id,
        skill,
        reputation: 0.5,
        jobs: 0,
        balance: 1000,
      };
      agents.set(body.id, agent);
      saveAgent(agent);
      return json({ agent: { id: agent.id, skill: agent.skill, reputation: agent.reputation, balance: agent.balance } });
    }

    // ── POST /tasks ─────────────────────────────────────────
    if (method === "POST" && path === "/tasks") {
      const body = await req.json() as {
        goal: string;
        budget: number;
        value: number;
        latencyTarget?: string;
        verificationLevel?: string;
        verificationClass?: string;
      };
      if (!body.goal) return error("goal is required");
      if (agents.size < 3) return error("need at least 3 registered agents");

      // Validate verification class
      const vc = (body.verificationClass ?? "sharp") as VerificationClass;
      if (!ADMITTED_CLASSES.includes(vc)) {
        return error(`verificationClass must be one of: ${ADMITTED_CLASSES.join(", ")} (got "${vc}")`);
      }

      const id = `task-${taskSeq++}`;
      const task: Task = {
        id,
        goal: body.goal,
        budget: body.budget,
        value: body.value,
        latencyTarget: (body.latencyTarget as Task["latencyTarget"]) ?? "normal",
        verificationLevel: (body.verificationLevel as Task["verificationLevel"]) ?? "standard",
        verificationClass: vc,
      };

      const agentList = Array.from(agents.values());
      const dags = generateDAGs(task, agentList);
      const market = new LMSRMarket();

      // Open markets for all DAGs
      for (const dag of dags) {
        market.open(dag.id, 100);

        // Agents trade based on who's assigned to each DAG
        for (const agent of agentList) {
          const assignedSkills = dag.nodes.map((n) => agents.get(n.agentId)?.skill ?? 0.5);

          let belief: number;
          if (dag.nodes.some((n) => n.agentId === agent.id)) {
            // Assigned agent knows their own skill
            belief = assignedSkills.reduce((s, v, i) => {
              const a = agents.get(dag.nodes[i].agentId);
              const est = a?.id === agent.id ? agent.skill : (a?.reputation ?? 0.5) * 0.8 + 0.1;
              return s + est;
            }, 0) / assignedSkills.length;
          } else {
            belief = assignedSkills.reduce((s, v, i) => {
              const a = agents.get(dag.nodes[i].agentId);
              return s + (a?.reputation ?? 0.5);
            }, 0) / assignedSkills.length;
          }

          belief *= 1 - 0.05 * dag.nodes.length;
          const deviation = Math.abs(belief - 0.5);
          const stake = Math.max(5, Math.round(deviation * 80 * Math.max(0.2, agent.reputation)));

          // Escrow balance
          const actualStake = Math.min(stake, agent.balance);
          if (actualStake > 0) {
            agent.balance -= actualStake;
            market.trade(dag.id, belief, actualStake);
          }
        }
      }

      // Compute prices
      const prices: Record<string, number> = {};
      for (const dag of dags) {
        prices[dag.id] = market.price(dag.id);
      }

      const record: TaskRecord = {
        id,
        task,
        status: "open",
        dags,
        winnerId: null,
        winnerEV: null,
        market,
        outcomeScore: null,
        completed: null,
        proposerBalances: new Map(),
        bonds: [],
      };
      tasks.set(id, record);

      return json({
        taskId: id,
        task,
        dags: dags.map((d) => ({
          id: d.id,
          strategy: d.strategy,
          nodes: d.nodes.map((n) => ({ id: n.id, agentId: n.agentId, type: n.type, cost: n.cost })),
        })),
        prices,
        status: record.status,
      });
    }

    // ── GET /tasks/:id ──────────────────────────────────────
    const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      const record = tasks.get(taskMatch[1]);
      if (!record) return error("task not found", 404);

      const prices: Record<string, number> = {};
      // For settled tasks loaded from DB, prices were stored separately
      if (record.status === "settled" && record.outcomeScore !== null) {
        const stored = getTaskFromDB(record.id);
        if (stored) {
          for (const dag of record.dags) {
            prices[dag.id] = stored.prices[dag.id] ?? record.market.price(dag.id);
          }
        } else {
          for (const dag of record.dags) prices[dag.id] = record.market.price(dag.id);
        }
      } else {
        for (const dag of record.dags) prices[dag.id] = record.market.price(dag.id);
      }

      return json({
        taskId: record.id,
        task: record.task,
        status: record.status,
        dags: record.dags.map((d) => ({
          id: d.id,
          strategy: d.strategy,
          nodes: d.nodes.map((n) => ({ agentId: n.agentId, type: n.type, cost: n.cost })),
          totalCost: d.nodes.reduce((s, n) => s + n.cost, 0),
        })),
        prices,
        winnerId: record.winnerId,
        winnerEV: record.winnerEV,
        outcomeScore: record.outcomeScore,
        completed: record.completed,
      });
    }

    // ── POST /tasks/:id/trade ──────────────────────────────
    const tradeMatch = path.match(/^\/tasks\/([^/]+)\/trade$/);
    if (method === "POST" && tradeMatch) {
      const record = tasks.get(tradeMatch[1]);
      if (!record) return error("task not found", 404);
      if (record.status !== "open") return error("trading closed");

      const body = await req.json() as { agentId: string; dagId: string; belief: number; stake: number };
      const agent = agents.get(body.agentId);
      if (!agent) return error("agent not found");
      if (!record.dags.some((d) => d.id === body.dagId)) return error("dag not found for this task");
      if (body.belief < 0 || body.belief > 1) return error("belief must be 0-1");
      if (body.stake < 1) return error("stake must be ≥ 1");
      if (body.stake > agent.balance) return error("insufficient balance");

      agent.balance -= body.stake;
      const newPrice = record.market.trade(body.dagId, body.belief, body.stake);

      // Track who staked what for settlement
      const key = `${body.agentId}:${body.dagId}`;
      record.proposerBalances.set(key, (record.proposerBalances.get(key) ?? 0) + body.stake);

      return json({
        dagId: body.dagId,
        belief: body.belief,
        staked: body.stake,
        newPrice: Math.round(newPrice * 1000) / 1000,
        remainingBalance: Math.round(agent.balance * 100) / 100,
      });
    }

    // ── POST /tasks/:id/resolve ────────────────────────────
    const resolveMatch = path.match(/^\/tasks\/([^/]+)\/resolve$/);
    if (method === "POST" && resolveMatch) {
      const record = tasks.get(resolveMatch[1]);
      if (!record) return error("task not found", 404);
      if (record.status !== "open") return error("already resolved");

      const prices: Record<string, number> = {};
      for (const dag of record.dags) {
        prices[dag.id] = record.market.price(dag.id);
      }

      // Pick the highest EV
      let bestDag: DAG | null = null;
      let bestEV = -Infinity;
      for (const dag of record.dags) {
        const p = prices[dag.id] ?? 0.5;
        const cost = dag.nodes.reduce((s, n) => s + n.cost, 0);
        const ev = p * record.task.value - cost;
        if (ev > bestEV) {
          bestEV = ev;
          bestDag = dag;
        }
      }

      if (!bestDag) return error("no feasible DAG");
      record.winnerId = bestDag.id;
      record.winnerEV = bestEV;
      record.status = "priced";

      // ── Bond escrow: lock 20% of winning DAG cost from assigned agents ──
      const BOND_PCT = 0.2;
      const escrowed: Bond[] = [];
      for (const node of bestDag.nodes) {
        const agent = agents.get(node.agentId);
        if (agent) {
          const bondAmount = Math.min(Math.round(node.cost * BOND_PCT), agent.balance);
          if (bondAmount > 0) {
            agent.balance -= bondAmount;
            escrowed.push({
              agentId: agent.id,
              amount: bondAmount,
              threshold: 0.5,
              status: "active",
            });
          }
        }
      }
      record.bonds = escrowed;

      return json({
        winner: {
          dagId: bestDag.id,
          strategy: bestDag.strategy,
          ev: Math.round(bestEV * 100) / 100,
          pSuccess: Math.round((prices[bestDag.id] ?? 0.5) * 1000) / 1000,
          cost: bestDag.nodes.reduce((s, n) => s + n.cost, 0),
          value: record.task.value,
        },
        dags: Object.fromEntries(
          record.dags.map((d) => [d.id, {
            price: prices[d.id],
            ev: Math.round((prices[d.id] * record.task.value - d.nodes.reduce((s, n) => s + n.cost, 0)) * 100) / 100,
          }])
        ),
        bonds: escrowed.map((b) => ({ agentId: b.agentId, amount: b.amount, threshold: b.threshold, status: b.status })),
        status: record.status,
      });
    }

    // ── POST /tasks/:id/result ─────────────────────────────
    const resultMatch = path.match(/^\/tasks\/([^/]+)\/result$/);
    if (method === "POST" && resultMatch) {
      const record = tasks.get(resultMatch[1]);
      if (!record) return error("task not found", 404);
      if (record.status !== "priced") return error("task must be priced first");
      if (!record.winnerId) return error("no winner selected");

      const body = await req.json() as { agentId: string; success?: boolean };
      const agent = agents.get(body.agentId);
      if (!agent) return error("agent not found");

      // Use the verifier to compute outcome
      const winnerDag = record.dags.find((d) => d.id === record.winnerId)!;
      const agentMap = new Map(Array.from(agents.values()).map((a) => [a.id, a as Agent]));
      const outcomeScore = verify(winnerDag, agentMap, record.task, () => rand());
      const completed = body.success !== undefined ? body.success : isCompleted(outcomeScore, record.task);

      record.outcomeScore = outcomeScore;
      record.completed = completed;
      record.status = "settled";

      // ── Bond settlement: release or slash based on outcome ──
      const BOND_THRESHOLD = 0.5;
      const settledBonds: Array<{ agentId: string; amount: number; status: string }> = [];
      for (const bond of record.bonds) {
        if (bond.status !== "active") {
          settledBonds.push({ agentId: bond.agentId, amount: bond.amount, status: bond.status });
          continue;
        }
        if (outcomeScore >= BOND_THRESHOLD) {
          // Release bond back to agent
          const a = agents.get(bond.agentId);
          if (a) {
            a.balance += bond.amount;
            bond.status = "released";
            settledBonds.push({ agentId: bond.agentId, amount: bond.amount, status: "released" });
          }
        } else {
          // Slash bond — forfeit to the treasury (not returned to agent)
          bond.status = "slashed";
          settledBonds.push({ agentId: bond.agentId, amount: bond.amount, status: "slashed" });
        }
      }

      // Persist: save task result and involved agents
      const finalPrices: Record<string, number> = {};
      for (const dag of record.dags) finalPrices[dag.id] = record.market.price(dag.id);
      saveTask({
        id: record.id,
        task: record.task,
        status: record.status,
        dags: record.dags,
        winnerId: record.winnerId,
        winnerEV: record.winnerEV,
        outcomeScore,
        completed,
        prices: finalPrices,
        bonds: settledBonds,
      });

      // Settle: update reputation for involved agents
      const involvedIds = Array.from(new Set(winnerDag.nodes.map((n) => n.agentId)));
      const updatedReps: Array<{ agentId: string; oldRep: number; newRep: number; change: string }> = [];
      for (const aid of involvedIds) {
        const a = agents.get(aid);
        if (a) {
          const oldRep = a.reputation;
          updateReputation(a, outcomeScore);
          saveAgent(a);
          const change = ((a.reputation - oldRep) * 100).toFixed(1);
          updatedReps.push({ agentId: aid, oldRep: Math.round(oldRep * 100) / 100, newRep: Math.round(a.reputation * 100) / 100, change: `${change > "0" ? "+" : ""}${change}%` });
        }
      }

      return json({
        taskId: record.id,
        outcomeScore: Math.round(outcomeScore * 1000) / 1000,
        completed,
        winningDag: winnerDag.strategy,
        reputations: updatedReps,
        bonds: settledBonds,
        status: record.status,
      });
    }

    // ── GET /agents ─────────────────────────────────────────
    if (method === "GET" && path === "/agents") {
      const list = Array.from(agents.values()).map((a) => ({
        id: a.id,
        skill: Math.round(a.skill * 100) / 100,
        reputation: Math.round(a.reputation * 100) / 100,
        jobs: a.jobs,
        balance: Math.round(a.balance * 100) / 100,
      }));
      return json(list);
    }

    // ── GET /reputation/:agentId ────────────────────────────
    const repMatch = path.match(/^\/reputation\/([^/]+)$/);
    if (method === "GET" && repMatch) {
      const agent = agents.get(repMatch[1]);
      if (!agent) return error("agent not found", 404);
      return json({
        agentId: agent.id,
        skill: Math.round(agent.skill * 100) / 100,
        reputation: Math.round(agent.reputation * 100) / 100,
        jobs: agent.jobs,
        balance: Math.round(agent.balance * 100) / 100,
      });
    }

    // ── POST /run — full lifecycle in one call ═════════════
    if (method === "POST" && path === "/run") {
      const body = await req.json() as {
        agents?: Array<{ id: string; skill: number }>;
        task: { goal: string; budget: number; value: number; latencyTarget?: string; verificationLevel?: string; verificationClass?: string };
      };
      const taskBody = body.task;

      // Validate verification class
      const vc = (taskBody.verificationClass ?? "sharp") as VerificationClass;
      if (!ADMITTED_CLASSES.includes(vc)) {
        return error(`verificationClass must be one of: ${ADMITTED_CLASSES.join(", ")} (got "${vc}")`);
      }

      // 1. Register agents
      const registered: string[] = [];
      if (body.agents) {
        for (const a of body.agents) {
          if (!agents.has(a.id)) {
            const newAgent: StoredAgent = {
              id: a.id,
              skill: a.skill,
              reputation: 0.5,
              jobs: 0,
              balance: 1000,
            };
            agents.set(a.id, newAgent);
            saveAgent(newAgent);
            registered.push(a.id);
          }
        }
      }
      if (agents.size < 3) return error("need at least 3 registered agents");

      // 2. Submit task
      const taskId = `task-${taskSeq++}`;
      const task: Task = {
        id: taskId,
        goal: taskBody.goal,
        budget: taskBody.budget,
        value: taskBody.value,
        latencyTarget: (taskBody.latencyTarget as Task["latencyTarget"]) ?? "normal",
        verificationLevel: (taskBody.verificationLevel as Task["verificationLevel"]) ?? "standard",
        verificationClass: vc,
      };

      const agentList = Array.from(agents.values());
      const dags = generateDAGs(task, agentList);
      const market = new LMSRMarket();

      for (const dag of dags) {
        market.open(dag.id, 100);
        for (const agent of agentList) {
          const assignedSkills = dag.nodes.map((n) => agents.get(n.agentId)?.skill ?? 0.5);
          let belief: number;
          if (dag.nodes.some((n) => n.agentId === agent.id)) {
            belief = assignedSkills.reduce((s, v, i) => {
              const a = agents.get(dag.nodes[i].agentId);
              const est = a?.id === agent.id ? agent.skill : (a?.reputation ?? 0.5) * 0.8 + 0.1;
              return s + est;
            }, 0) / assignedSkills.length;
          } else {
            belief = assignedSkills.reduce((s, v, i) => {
              const a = agents.get(dag.nodes[i].agentId);
              return s + (a?.reputation ?? 0.5);
            }, 0) / assignedSkills.length;
          }
          belief *= 1 - 0.05 * dag.nodes.length;
          const deviation = Math.abs(belief - 0.5);
          const stake = Math.max(5, Math.round(deviation * 80 * Math.max(0.2, agent.reputation)));
          const actualStake = Math.min(stake, agent.balance);
          if (actualStake > 0) {
            agent.balance -= actualStake;
            market.trade(dag.id, belief, actualStake);
          }
        }
      }

      const prices: Record<string, number> = {};
      for (const dag of dags) prices[dag.id] = market.price(dag.id);

      const record: TaskRecord = {
        id: taskId,
        task,
        status: "open",
        dags,
        winnerId: null,
        winnerEV: null,
        market,
        outcomeScore: null,
        completed: null,
        proposerBalances: new Map(),
        bonds: [],
      };
      tasks.set(taskId, record);

      // 3. Resolve — pick highest EV
      let bestDag: DAG | null = null;
      let bestEV = -Infinity;
      for (const dag of dags) {
        const p = prices[dag.id] ?? 0.5;
        const cost = dag.nodes.reduce((s, n) => s + n.cost, 0);
        const ev = p * task.value - cost;
        if (ev > bestEV) { bestEV = ev; bestDag = dag; }
      }
      if (!bestDag) return error("no feasible DAG");
      record.winnerId = bestDag.id;
      record.winnerEV = bestEV;
      record.status = "priced";

      // 4. Execute & verify — simulate with the verifier
      const agentMap = new Map(Array.from(agents.values()).map((a) => [a.id, a as Agent]));
      const outcomeScore = verify(bestDag, agentMap, task, () => rand());
      const completed = isCompleted(outcomeScore, task);
      record.outcomeScore = outcomeScore;
      record.completed = completed;
      record.status = "settled";

      // Persist: save task result
      saveTask({
        id: taskId,
        task,
        status: record.status,
        dags,
        winnerId: bestDag.id,
        winnerEV: bestEV,
        outcomeScore,
        completed,
        prices,
      });

      // 5. Update reputation and persist agents
      const involvedIds = Array.from(new Set(bestDag.nodes.map((n) => n.agentId)));
      const repChanges: Array<{ agentId: string; oldRep: number; newRep: number }> = [];
      for (const aid of involvedIds) {
        const a = agents.get(aid);
        if (a) {
          const oldRep = a.reputation;
          updateReputation(a, outcomeScore);
          saveAgent(a);
          repChanges.push({ agentId: aid, oldRep: Math.round(oldRep * 1000) / 1000, newRep: Math.round(a.reputation * 1000) / 1000 });
        }
      }

      return json({
        summary: {
          taskId,
          goal: task.goal,
          agents: registered.length > 0 ? `registered ${registered.length} new agents` : `used ${agents.size} existing agents`,
        },
        market: Object.fromEntries(
          dags.map((d) => [d.strategy, {
            price: Math.round((prices[d.id] ?? 0.5) * 1000) / 1000,
            ev: Math.round(((prices[d.id] ?? 0.5) * task.value - d.nodes.reduce((s, n) => s + n.cost, 0)) * 100) / 100,
            nodes: d.nodes.map((n) => ({ agentId: n.agentId, type: n.type })),
          }])
        ),
        winner: {
          strategy: bestDag.strategy,
          dagId: bestDag.id,
          pSuccess: Math.round((prices[bestDag.id] ?? 0.5) * 1000) / 1000,
          ev: Math.round(bestEV * 100) / 100,
        },
        outcome: {
          completed,
          score: Math.round(outcomeScore * 1000) / 1000,
        },
        reputationChanges: repChanges,
      });
    }

    // ── GET /tasks (list all persisted tasks) ───────────────
    if (method === "GET" && path === "/tasks") {
      const stored = getAllTasks();
      return json(stored.map((t) => ({
        taskId: t.id,
        goal: t.task.goal,
        status: t.status,
        winner: t.winnerId,
        completed: t.completed,
        createdAt: t.createdAt,
      })));
    }

    // ── GET /health ────────────────────────────────────────
    if (path === "/health") {
      return json({
        service: "aex-scaffold",
        status: "ok",
        agents: agents.size,
        tasks: tasks.size,
        openTasks: Array.from(tasks.values()).filter((t) => t.status === "open").length,
      });
    }

    return error("not found", 404);
  } catch (e) {
    return error((e as Error).message);
  }
}

// ── Start server ───────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const DB_PATH = process.env.DB_PATH ?? "./aex-scaffold.db";

// Initialize database and load existing data
initDB(DB_PATH);

for (const agent of getAllAgents()) {
  agents.set(agent.id, agent);
}
// Recover task sequence counter from existing tasks
const existingTasks = getAllTasks();
let maxTaskNum = 0;
for (const t of existingTasks) {
  const match = t.id.match(/^task-(\d+)$/);
  if (match) maxTaskNum = Math.max(maxTaskNum, parseInt(match[1], 10) + 1);
}
taskSeq = maxTaskNum;
// Load existing tasks into read-only in-memory store
for (const t of existingTasks) {
  // We store them so GET /tasks/:id works, but markets aren't reconstructable
  // (open tasks are ephemeral — only settled tasks persist)
  if (t.status === "settled") {
    const market = new LMSRMarket();
    tasks.set(t.id, {
      id: t.id,
      task: t.task,
      status: t.status as TaskRecord["status"],
      dags: t.dags,
      winnerId: t.winnerId,
      winnerEV: t.winnerEV,
      market,
      outcomeScore: t.outcomeScore,
      completed: t.completed,
      proposerBalances: new Map(),
      bonds: [],
    });
  }
}

const server = Bun.serve({ port: PORT, fetch: handler });

console.log(`
╔══════════════════════════════════════════════════════════╗
║             AEX Scaffold API Server                     ║
╚══════════════════════════════════════════════════════════╝

  Server: http://localhost:${PORT}
  Health: http://localhost:${PORT}/health
  DB:     ${DB_PATH}
  Agents: ${agents.size}
  Tasks:  ${tasks.size}

Endpoints:
  POST /agents/register    Create an agent
  POST /tasks              Submit a task (auto-generates DAGs)
  GET  /tasks              List all tasks
  GET  /tasks/:id          See task state and prices
  POST /tasks/:id/trade    Stake tokens on a DAG
  POST /tasks/:id/resolve  Close market, pick winner
  POST /tasks/:id/result   Submit execution outcome
  POST /run                Full lifecycle (one-shot)
  GET  /agents             List all agents
  GET  /reputation/:id     Agent reputation

Quick start:
  # One-shot: register agents + run a task + resolve + settle
  curl -X POST http://localhost:${PORT}/run -H "Content-Type: application/json" -d '{"agents":[{"id":"alice","skill":0.85},{"id":"bob","skill":0.70},{"id":"carol","skill":0.55},{"id":"dave","skill":0.40},{"id":"eve","skill":0.65},{"id":"frank","skill":0.50}],"task":{"goal":"Build a trading bot","budget":300,"value":1000}}'

  # Or step-by-step:
  curl -X POST http://localhost:${PORT}/agents/register -H "Content-Type: application/json" -d '{"id":"alice","skill":0.85}'
`);
