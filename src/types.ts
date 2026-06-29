/**
 * types.ts — Core data structures for the AEX scaffold.
 *
 * These are the minimal types needed to run an agent execution market.
 * Everything in this scaffold is built on these six interfaces.
 */

/** An agent that can propose work, price work, or execute work. */
export interface Agent {
  id: string;
  /** Skill level 0-1. Probability of successfully completing any node. */
  skill: number;
  /** Reputation running average (0-1). Updated after each task. */
  reputation: number;
  /** How many tasks this agent has participated in. */
  jobs: number;
}

/** A task submitted to the market for execution. */
export interface Task {
  id: string;
  /** Human-readable goal (e.g. "Fetch BTC price from Coinbase"). */
  goal: string;
  /** Maximum the submitter will pay (cost floor for execution). */
  budget: number;
  /** Value delivered if the task succeeds (EV ceiling). */
  value: number;
  /** Latency class — affects deadline and strategy selection. */
  latencyTarget: "fast" | "normal" | "batch";
  /** Verification strictness. */
  verificationLevel: "lenient" | "standard" | "strict";
}

/** A single node in an execution DAG — one unit of work by one agent. */
export interface Node {
  id: string;
  /** Agent assigned to this node. */
  agentId: string;
  /** Node type label (e.g. "research", "plan", "code", "verify"). */
  type: string;
  /** Cost to execute this node (paid to the agent). */
  cost: number;
}

/** A DAG (directed acyclic graph) — an execution plan for a task. */
export interface DAG {
  id: string;
  /** Strategy label (e.g. "fast-path", "redundant-core"). */
  strategy: string;
  /** Nodes in the graph (ordered topologically). */
  nodes: Node[];
  /** Edges from -> to node IDs. */
  edges: [string, string][];
}

/** The result of executing a task through the engine. */
export interface TaskResult {
  task: Task;
  /** DAGs that were proposed and priced. */
  dags: DAG[];
  /** Market-priced success probabilities. */
  prices: Map<string, number>;
  /** The winning DAG id. */
  winnerId: string;
  /** Expected value of the winner. */
  winnerEV: number;
  /** Did execution succeed? */
  completed: boolean;
  /** Outcome quality score (0-1). */
  outcomeScore: number;
  /** Calibration error: |market_price - actual_outcome|. */
  calibrationError: number;
}

/** A full season run — a sequence of tasks with accumulating reputation. */
export interface SeasonResult {
  tasks: TaskResult[];
  calibrationErrors: number[];
  /** Final agent states (reputation, jobs). */
  agents: Agent[];
}
