/**
 * engine.ts — Main orchestration loop for the AEX scaffold.
 *
 * The engine takes a task, runs it through the full pipeline, and
 * returns a result. This is the core abstraction — everything else
 * (LMSR, DAGs, verifier, reputation) is a plug-in.
 *
 * THE PIPELINE:
 *   1. PROPOSE → Generate candidate DAGs from strategy templates
 *   2. PRICE   → Open LMSR markets, let agents trade on each DAG
 *   3. RANK    → Compute EV = P(success) × value - cost, pick best
 *   4. EXECUTE → Simulate execution based on agent skills
 *   5. VERIFY  → Score the outcome (verifier.ts)
 *   6. SETTLE  → Update reputation, compute calibration error
 *
 * For the scaffold, "execution" is a simulation. In a live system,
 * this is where a real agent would actually do the work.
 */

import type { Agent, DAG, Task, TaskResult } from "./types";
import { LMSRMarket } from "./lmsr";
import { generateDAGs } from "./dags";
import { verify, isCompleted } from "./verifier";
import { updateReputation } from "./reputation";

export class ScaffoldEngine {
  /** Persistent market state across tasks. */
  readonly market = new LMSRMarket();
  /** Persistent RNG state (deterministic for reproducibility). */
  private rngState: number;
  private readonly agents: Map<string, Agent>;

  constructor(agents: Agent[], seed: number = Date.now()) {
    this.rngState = seed;
    this.agents = new Map(agents.map((a) => [a.id, a]));
  }

  /** Deterministic random number 0-1. */
  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) & 0x7fffffff;
    return this.rngState / 0x7fffffff;
  }

  /** Run one task through the full pipeline. */
  runTask(task: Task): TaskResult {
    // --- 1. PROPOSE ---
    const agentList = Array.from(this.agents.values());
    const dags = generateDAGs(task, agentList);

    // --- 2. PRICE (LMSR) ---
    for (const dag of dags) {
      this.market.open(dag.id, 100);

      // Compute the true quality of this DAG based on who's assigned
      const assignedSkills = dag.nodes.map((n) => this.agents.get(n.agentId)?.skill ?? 0.5);

      // Each agent forms a belief about this DAG's success probability
      for (const agent of agentList) {
        let belief: number;

        if (dag.nodes.some((n) => n.agentId === agent.id)) {
          // Agent is assigned to this DAG — they know their own capability
          // and estimate others based on their visible reputation
          belief = assignedSkills.reduce((s, v, i) => {
            const assignedAgent = this.agents.get(dag.nodes[i].agentId);
            const estimated = assignedAgent?.id === agent.id
              ? agent.skill  // own skill — known precisely
              : (assignedAgent?.reputation ?? 0.5) * 0.8 + 0.1; // others — noisy estimate
            return s + estimated;
          }, 0) / assignedSkills.length;
        } else {
          // Agent is NOT assigned — estimates based on visible reputations
          belief = assignedSkills.reduce((s, v, i) => {
            const assignedAgent = this.agents.get(dag.nodes[i].agentId);
            return s + (assignedAgent?.reputation ?? 0.5);
          }, 0) / assignedSkills.length;
        }

        // Apply complexity penalty: more nodes = more failure points
        belief *= 1 - 0.05 * dag.nodes.length;

        // Stake based on conviction strength, not gap from current price
        // Agents with strong beliefs (far from 50/50) trade more
        // Reputation amplifies: high-rep agents are more confident
        const deviation = Math.abs(belief - 0.5);
        const stake = Math.max(5, Math.round(
          deviation * 80 * Math.max(0.2, agent.reputation ?? 0.5)
        ));
        this.market.trade(dag.id, belief, stake);
      }
    }

    // --- 3. RANK (pick best EV) ---
    const prices = new Map<string, number>();
    for (const dag of dags) {
      prices.set(dag.id, this.market.price(dag.id));
    }

    let bestDag: DAG | null = null;
    let bestEV = -Infinity;
    for (const dag of dags) {
      const p = prices.get(dag.id) ?? 0.5;
      const cost = dag.nodes.reduce((s, n) => s + n.cost, 0);
      const ev = p * task.value - cost;
      if (ev > bestEV) {
        bestEV = ev;
        bestDag = dag;
      }
    }

    if (!bestDag) {
      throw new Error("No feasible DAG found");
    }

    // --- 4. EXECUTE (simulate) ---
    // Each node succeeds with probability = assigned agent's skill
    for (const node of bestDag.nodes) {
      const agent = this.agents.get(node.agentId);
      if (agent) {
        agent.reputation = agent.reputation || 0.5;
      }
    }

    // --- 5. VERIFY ---
    const outcomeScore = verify(bestDag, this.agents, task, () => this.rand());
    const completed = isCompleted(outcomeScore, task);

    // --- 6. SETTLE ---
    // Update reputation for all agents involved
    const involvedAgentIds = Array.from(new Set(bestDag.nodes.map((n) => n.agentId)));
    for (const agentId of involvedAgentIds) {
      const agent = this.agents.get(agentId);
      if (agent) {
        updateReputation(agent, outcomeScore);
      }
    }

    // Calibration: how accurate was the market?
    const marketPrice = prices.get(bestDag.id) ?? 0.5;
    const actual = completed ? 1 : 0;
    const calibrationError = Math.abs(marketPrice - actual);

    return {
      task,
      dags,
      prices,
      winnerId: bestDag.id,
      winnerEV: bestEV,
      completed,
      outcomeScore,
      calibrationError,
    };
  }

  /** Run a sequence of tasks (a "season") and return all results. */
  runSeason(tasks: Task[]): { results: TaskResult[]; agents: Agent[] } {
    const results: TaskResult[] = [];
    for (const task of tasks) {
      const result = this.runTask(task);
      results.push(result);
    }
    return { results, agents: Array.from(this.agents.values()) };
  }
}
