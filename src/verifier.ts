/**
 * verifier.ts — Simple outcome scoring for the AEX scaffold.
 *
 * The verifier checks how well a DAG execution went and produces
 * a quality score. In production this would involve real testing,
 * code review, or external data. Here we simulate it based on the
 * assigned agents' skills and the DAG's structure.
 *
 * Score components:
 *   - Node quality: average skill of assigned agents (weighted by node count)
 *   - Complexity penalty: more nodes = more failure points
 *   - Noise: small random factor (simulates real-world uncertainty)
 */

import type { Agent, DAG, Task } from "./types.ts";

/**
 * Compute an outcome score for a DAG execution.
 *
 * @param dag — the DAG that was executed
 * @param agents — all agents (to look up skill/reputation)
 * @param task — the original task
 * @param rand — deterministic random from the engine
 * @returns quality score 0-1
 */
export function verify(
  dag: DAG,
  agents: Map<string, Agent>,
  task: Task,
  rand: () => number,
): number {
  if (dag.nodes.length === 0) return 0;

  // Base quality: average skill of assigned agents
  let totalSkill = 0;
  let nodeCount = 0;
  for (const node of dag.nodes) {
    const agent = agents.get(node.agentId);
    if (agent) {
      totalSkill += agent.skill;
      nodeCount++;
    }
  }
  const baseQuality = nodeCount > 0 ? totalSkill / nodeCount : 0.5;

  // Complexity penalty: each node is a failure point
  const complexityPenalty = 1 - 0.05 * dag.nodes.length;

  // Check whether each node actually succeeded (deterministic by agent skill)
  let successCount = 0;
  for (const node of dag.nodes) {
    const agent = agents.get(node.agentId);
    const p = agent ? agent.skill : 0.5;
    if (rand() < p) successCount++;
  }
  const execRatio = successCount / dag.nodes.length;

  // Verification level modifier
  const levelMod = task.verificationLevel === "strict" ? 0.95 :
                   task.verificationLevel === "standard" ? 1.0 : 1.05;

  // Fuse: base quality × complexity × execution × small noise
  const score = Math.max(0, Math.min(1,
    baseQuality * complexityPenalty * execRatio * levelMod
      + (rand() - 0.5) * 0.05
  ));

  return score;
}

/**
 * Determine if a task was "completed" based on outcome score.
 */
export function isCompleted(outcomeScore: number, task: Task): boolean {
  const threshold = task.verificationLevel === "strict" ? 0.7 :
                    task.verificationLevel === "standard" ? 0.6 : 0.5;
  return outcomeScore >= threshold;
}
