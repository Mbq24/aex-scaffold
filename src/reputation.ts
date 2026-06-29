/**
 * reputation.ts — Simple reputation tracker for the AEX scaffold.
 *
 * Reputation is a running exponential moving average of outcome scores.
 * This is intentionally simple — agents that consistently deliver good
 * work accumulate high reputation, which influences market pricing
 * (agents trust plans involving high-reputation agents more).
 */

import type { Agent } from "./types.ts";

/**
 * Update an agent's reputation after a task completes.
 * Uses exponential moving average with α=0.3 (recent outcomes matter more).
 */
export function updateReputation(agent: Agent, outcomeScore: number): void {
  const alpha = 0.3;
  agent.reputation = agent.jobs === 0
    ? outcomeScore                             // first impression
    : alpha * outcomeScore + (1 - alpha) * agent.reputation; // EMA
  agent.jobs++;
}

/**
 * Create a set of agents with varied skills for the demo.
 */
export function createDemoAgents(count: number = 6): Agent[] {
  const archetypes = [
    { prefix: "expert", skill: 0.85 },
    { prefix: "skilled", skill: 0.70 },
    { prefix: "competent", skill: 0.55 },
    { prefix: "novice", skill: 0.40 },
    { prefix: "unreliable", skill: 0.25 },
    { prefix: "wildcard", skill: 0.60 },
  ];

  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const a = archetypes[i % archetypes.length];
    // Add some variance so same-type agents aren't identical
    const variance = (Math.random() - 0.5) * 0.15;
    agents.push({
      id: `${a.prefix}-${Math.floor(i / archetypes.length)}`,
      skill: Math.max(0.05, Math.min(0.99, a.skill + variance)),
      reputation: 0.5,
      jobs: 0,
    });
  }
  return agents;
}
