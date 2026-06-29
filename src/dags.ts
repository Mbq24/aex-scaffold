/**
 * dags.ts — DAG generation for the AEX scaffold.
 *
 * Each strategy maps to a different "tier" of agent quality:
 *
 *   "economy"    →  2 agents, cheapest pool (low skill, low cost)
 *   "balanced"   →  3 agents, mid-tier skill, moderate cost
 *   "premium"    →  3 agents, highest skill, highest cost
 *
 * The market prices each DAG based on who's assigned, so the
 * system demonstrates the classic tradeoff: pay more for reliability
 * or save money and accept risk. The LMSR market should price
 * economy at ~25-40%, balanced at ~50-65%, premium at ~70-85%.
 */

import type { Agent, DAG, Task } from "./types";

let dagCounter = 0;
function nextDagId(): string {
  return `dag-${dagCounter++}`;
}

/** Generate 3 DAGs for a task — one per strategy tier. */
export function generateDAGs(task: Task, agents: Agent[]): DAG[] {
  // Sort agents by skill so we can pick tiers
  const sorted = [...agents].sort((a, b) => b.skill - a.skill);
  const topTier = sorted.slice(0, Math.max(3, sorted.length));
  const midTier = sorted.slice(2, Math.max(5, sorted.length));
  const lowTier = sorted.slice(4);

  // Pick agents, falling back if a tier is empty
  const pick = (pool: Agent[], n: number): Agent[] => {
    const result: Agent[] = [];
    for (let i = 0; i < n; i++) {
      result.push(pool[i % pool.length]);
    }
    return result;
  };

  const dags: DAG[] = [];

  // --- economy: cheap, fast, low reliability ---
  dags.push(buildDAG("economy", task, pick(lowTier.length > 0 ? lowTier : midTier, 2), [
    { type: "research", cost: task.budget * 0.20 },
    { type: "code", cost: task.budget * 0.50 },
  ]));

  // --- balanced: moderate skill, some redundancy ---
  dags.push(buildDAG("balanced", task, pick(midTier.length > 0 ? midTier : topTier, 3), [
    { type: "research", cost: task.budget * 0.20 },
    { type: "code", cost: task.budget * 0.50 },
    { type: "verify", cost: task.budget * 0.30 },
  ]));

  // --- premium: top talent, thorough ---
  dags.push(buildDAG("premium", task, pick(topTier, 3), [
    { type: "research", cost: task.budget * 0.20 },
    { type: "code", cost: task.budget * 0.50 },
    { type: "deploy", cost: task.budget * 0.30 },
  ]));

  return dags;
}

interface NodeTemplate {
  type: string;
  cost: number;
}

function buildDAG(
  strategy: string,
  task: Task,
  assignedAgents: Agent[],
  nodes: NodeTemplate[],
): DAG {
  const dagNodes = nodes.map((n, i) => ({
    id: `${strategy}-n${i}-${nextDagId()}`,
    agentId: assignedAgents[i % assignedAgents.length].id,
    type: n.type,
    cost: n.cost,
  }));
  const edges: [string, string][] = [];
  for (let i = 1; i < dagNodes.length; i++) {
    edges.push([dagNodes[i - 1].id, dagNodes[i].id]);
  }
  return {
    id: nextDagId(),
    strategy,
    nodes: dagNodes,
    edges,
  };
}
