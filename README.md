# AEX Scaffold

A minimal, educational implementation of an **Agentic Execution Exchange** — a market where agents price, bid on, and execute work.

## Concept

The core problem: **How do you know an AI agent will do the work it promises?**

AEX solves this with a prediction market. Agents stake tokens on whether a proposed execution plan (DAG) will succeed. The collective belief produces a **market price** — the probability of success. The engine picks the plan with the highest expected value, executes it, verifies the outcome, and updates everyone's reputation.

```
Task → Propose DAGs → LMSR Price → Pick best EV → Execute → Verify → Update reputation
```

## Architecture

```
src/
├── types.ts              # Core data structures (Agent, Task, DAG, TaskResult)
├── lmsr.ts               # LMSR market maker — prices success probability
├── dags.ts               # DAG templates — economy/balanced/premium strategies
├── engine.ts             # Main loop — orchestrates the full pipeline
├── verifier.ts           # Outcome scoring — quality × complexity × execution
├── reputation.ts         # Exponential moving average tracker
├── server.ts             # HTTP API server — agents register, trade, resolve
├── test_lifecycle.ts     # End-to-end lifecycle test
└── demo.ts               # Runnable demo — 15 tasks, prints results table
```

### The LMSR Market

The **Logarithmic Market Scoring Rule** is the mathematical engine:

```
P(success) = 1 / (1 + exp(-q / b))
```

Where `q` = net tokens wagered (YES minus NO) and `b` = liquidity depth. Each agent trades by staking tokens behind their belief. The resulting price is the **capital-weighted consensus** of all participating agents.

### Strategy Tiers

| Strategy | Agents | Cost | Expected Reliability |
|----------|--------|------|---------------------|
| **economy** | 2 lowest-skill agents | Low | Low |
| **balanced** | 3 mid-skill agents + verification | Medium | Medium |
| **premium** | 3 top-skill agents | High | High |

The market prices each DAG based on who's assigned. The engine picks the strategy with the best **Expected Value = P(success) × task_value - cost**.

## Quick Start

```bash
# Requires Bun (https://bun.sh)
cd aex-scaffold
bun run src/demo.ts
```

You'll see:
1. Per-task results — market price, expected value, actual outcome
2. Summary — Brier score (calibration quality) and market spread
3. Agent rankings — who built the best reputation over the season
4. Strategy performance — which approach won most often

## Live API Server

```bash
bun run src/server.ts
# Server on http://localhost:8080
```

The server lets external agents interact with the market over HTTP. Each agent has a **balance** (1000 starting tokens) and a **reputation** (updated after each task).

### Task Lifecycle

```
OPEN → (trading) → PRICED → (execution) → EXECUTED → (verification) → SETTLED
```

### API Endpoints

**`POST /agents/register`** — Create an agent
```json
{ "id": "alice", "skill": 0.85 }
// → { "agent": { "id": "alice", "skill": 0.85, "reputation": 0.5, "balance": 1000 } }
```

**`POST /tasks`** — Submit a task (auto-generates 3 DAGs, opens LMSR markets)
```json
{ "goal": "Build a DCA strategy for ETH", "budget": 300, "value": 1200 }
// → { "taskId": "task-0", "dags": [...], "prices": { "dag-0": 0.45, ... }, "status": "open" }
```

**`GET /tasks/:id`** — See task state, DAGs, and current prices
```json
// → { "taskId": "...", "status": "open", "dags": [...], "prices": {...} }
```

**`POST /tasks/:id/trade`** — Stake tokens on a DAG's success
```json
{ "agentId": "alice", "dagId": "dag-0", "belief": 0.8, "stake": 50 }
// → { "newPrice": 0.574, "staked": 50, "remainingBalance": 935 }
```

**`POST /tasks/:id/resolve`** — Close the market, pick the highest-EV DAG
```json
{ "agentId": "alice" }
// → { "winner": { "strategy": "economy", "ev": 390, "pSuccess": 0.5 }, ... }
```

**`POST /tasks/:id/result`** — Submit execution outcome (triggers settlement + reputation update)
```json
{ "agentId": "alice", "success": true }
// → { "outcomeScore": 0.549, "completed": true, "winningDag": "economy", "reputations": [...] }
```

**`GET /agents`** — List all agents with reputation and balances
**`GET /reputation/:agentId`** — Single agent's stats

### Full Lifecycle Test

```bash
bun run src/test_lifecycle.ts
```

Runs a complete cycle: register → task → trade → resolve → result → verify final state.

## What's Not Included (deliberately)

This scaffold strips AEX down to its core. The full protocol adds:

- **Entropy Swaps** — agent-to-agent derivatives on execution parameters
- **Optimistic Oracle** — bond/dispute game theory for settlement
- **Plackett-Luce ranking** — Bayesian leaderboard for execution graphs
- **Adversarial agents** — colluders, sybils, and fraud detection
- **Staking/Liquidity pools** — capital commitment and treasury
- **On-chain settlement** — Solidity contracts for real token transfers
- **Frontend** — dashboard or API server

These are all in the full `dbot-agent-v0` codebase (github.com/casey1088/dbot-agent-v0).

## How to Extend

The scaffold is designed to be modified. Try:

```typescript
// 1. Add a new strategy in dags.ts
dags.push(buildDAG("audited", task, topAgents, [
  { type: "research", cost: budget * 0.15 },
  { type: "code", cost: budget * 0.40 },
  { type: "audit", cost: budget * 0.35 },
  { type: "deploy", cost: budget * 0.10 },
]));

// 2. Change the verifier to add a penalty for failed nodes
// src/verifier.ts: add `penalty` weight to the score

// 3. Change the LMSR liquidity parameter
// src/engine.ts: this.market.open(dag.id, 200) // deeper market
```

## License

MIT — use it, fork it, build on it.
