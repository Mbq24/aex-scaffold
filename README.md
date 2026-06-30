# AEX Scaffold

A minimal LMSR-priced agent execution market for education and extensibility. Agents propose plans (DAGs), stake reputation tokens on their belief, and the market prices each plan. The highest-expected-value plan wins, gets executed, and outcomes update everyone's reputation.

**Live API:** https://blissful-simplicity-production.up.railway.app
**Dashboard:** https://blissful-simplicity-production.up.railway.app/dashboard
**Repo:** https://github.com/Mbq24/aex-scaffold

---

## How the Market Works

### The Full Lifecycle

```
                    ┌───────────────────┐
                    │  Someone submits  │
                    │  a task (goal,    │
                    │  budget, value)   │
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │  Server generates │
                    │  3 candidate DAGs │
                    │  (economy,        │
                    │  balanced,premium)│
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │  All agents auto- │
                    │  trade on each    │
                    │  DAG via LMSR     │
                    └────────┬──────────┘
                             │
                             ▼
                    ┌───────────────────┐
                    │  Prices settle.   │
          ┌────────►│  Highest EV DAG   │
          │         │  is the WINNER    │
          │         └────────┬──────────┘
          │                  │
          │                  ▼
          │         ┌───────────────────┐
          │         │  Bonds escrowed   │
          │         │  from assigned    │
          │         │  agents (20% cost)│
          │         └────────┬──────────┘
          │                  │
          │                  ▼
          │         ┌───────────────────┐
          │         │  DAG executed &   │
          │         │  verified → score │
          │         └────────┬──────────┘
          │                  │
          │         ┌────────┴────────┐
          │         ▼                 ▼
          │  ┌────────────┐   ┌────────────┐
          │  │ score≥0.5  │   │ score<0.5  │
          │  │ bonds      │   │ bonds      │
          │  │ RELEASED   │   │ SLASHED    │
          │  └──────┬─────┘   └──────┬─────┘
          │         │                │
          │         └───────┬────────┘
          │                 ▼
          │        ┌───────────────────┐
          │        │  Reputation       │
          │        │  updated (EMA)    │
          │        └────────┬──────────┘
          │                 │
          └─────────────────┘
         (next task loops)
```

---

## DAG Ranking — The Heart of It

This is how the market decides which plan is best.

### Step 1: The Server Generates 3 DAGs

When a task is submitted, the server sorts registered agents by skill and builds 3 strategies:

```
Task: "Build a trading bot" | budget=$300 | value=$1000

Available agents (sorted by skill):
  alice:    skill=0.85    rep=0.50
  bob:      skill=0.70    rep=0.50
  carol:    skill=0.55    rep=0.50
  dave:     skill=0.40    rep=0.50
```

**Economy DAG** (cheapest — 2 nodes, low-skill agents)
```
  ┌──────────┐     ┌──────────┐
  │ research │     │   code   │  Cost: $60 + $150 = $210
  │ (carol)  │────►│ (dave)   │  Skill: 0.55, 0.40
  └──────────┘     └──────────┘
```

**Balanced DAG** (moderate — 3 nodes, mid-skill agents)
```
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ research │     │   code   │     │ verify  │  Cost: $60 + $150 + $90 = $300
  │ (bob)    │────►│ (carol)  │────►│ (bob)   │  Skill: 0.70, 0.55, 0.70
  └──────────┘     └──────────┘     └──────────┘
```

**Premium DAG** (best agents — 3 nodes, top skill)
```
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ research │     │   code   │     │ deploy  │  Cost: $60 + $150 + $90 = $300
  │ (alice)  │────►│ (bob)    │────►│ (carol) │  Skill: 0.85, 0.70, 0.55
  └──────────┘     └──────────┘     └──────────┘
```

Node costs are percentages of the task budget:
- research: 20% of budget
- code: 50% of budget
- verify/deploy: 30% of budget

### Step 2: Agents Form Beliefs About Each DAG

Every registered agent computes a **belief** (0-1) for each DAG — their personal estimate of how likely that DAG is to succeed.

**Belief formula (for an agent assigned to the DAG):**

```
For each node on this DAG:
  if the node's agent == me:
    estimate = my actual skill    (I know myself)
  else:
    estimate = their_reputation × 0.8 + 0.1    (I estimate them)

belief = average of all estimates × (1 - 0.05 × node_count)
```

**Belief formula (for an agent NOT assigned to the DAG):**

```
For each node on this DAG:
  estimate = that agent's reputation    (all I know is public rep)

belief = average of all estimates × (1 - 0.05 × node_count)
```

**Worked example — alice (skill=0.85) estimating the Premium DAG:**

The Premium DAG has 3 nodes: alice (research), bob (code), carol (deploy)

```
Alice is assigned (research is her node), so:
  research (alice):  estimate = 0.85  (her own skill, exact)
  code (bob):        estimate = 0.50 × 0.8 + 0.1 = 0.50  (bob's rep)
  deploy (carol):    estimate = 0.50 × 0.8 + 0.1 = 0.50  (carol's rep)

  Average = (0.85 + 0.50 + 0.50) / 3 = 0.617
  Complexity penalty: 1 - 0.05 × 3 = 0.85
  Final belief = 0.617 × 0.85 = 0.524
```

**Worked example — alice estimating the Economy DAG:**

The Economy DAG has 2 nodes: carol (research), dave (code)

```
Alice is NOT assigned (she's not on this DAG), so:
  research (carol):  estimate = 0.50  (carol's rep)
  code (dave):       estimate = 0.50  (dave's rep)

  Average = (0.50 + 0.50) / 2 = 0.50
  Complexity penalty: 1 - 0.05 × 2 = 0.90
  Final belief = 0.50 × 0.90 = 0.450
```

Results after all 6 agents form beliefs:

| DAG | Avg Belief | Why |
|-----|-----------|-----|
| **Economy** | ~0.40 | Low-skill agents, assigned agents know they're weak |
| **Balanced** | ~0.48 | Mid-skill, 3-node penalty reduces it |
| **Premium** | ~0.55 | Top-skill agents, but 3-node penalty drags it down |

### Step 3: Agents Stake Tokens

Each agent stakes tokens proportional to their **conviction** — how far their belief is from 50/50.

```
stake = max(5, |belief - 0.5| × 80 × max(0.2, agent.reputation))
```

An agent with belief=0.55 and rep=0.5:
```
|0.55 - 0.5| × 80 × 0.5 = 0.05 × 80 × 0.5 = 2.0 → max(5, 2) = 5 tokens
```

An agent with belief=0.70 and rep=0.8:
```
|0.70 - 0.5| × 80 × 0.8 = 0.20 × 80 × 0.8 = 12.8 → max(5, 12.8) = 13 tokens
```

Agents with strong opinions and high reputation stake more. The stake gets deducted from their balance and fed into the LMSR market.

### Step 4: LMSR Prices Each DAG

The LMSR formula converts token stakes into a market price:

```
P(success) = 1 / (1 + exp(-q / 100))

where q = Σ(YES stakes) - Σ(NO stakes)
```

Each trade moves q, which moves price. After all agents trade, the prices converge:

```
For Economy:    many agents believe it's weak → net q is negative → P ≈ 0.35-0.40
For Balanced:   moderate belief → P ≈ 0.45-0.50
For Premium:    strong belief → net q is positive → P ≈ 0.55-0.65
```

**This is the market's consensus.** Not "what one person thinks" — the capital-weighted average of every agent's belief, with confident agents having more influence.

### Step 5: Expected Value Decides the Winner

The server computes Expected Value for each DAG:

```
EV = P(success) × task_value - total_cost
```

**Worked example** (budget=$300, value=$1000):

| DAG | Price (P) | Cost | EV = P × $1000 - Cost |
|-----|-----------|------|----------------------|
| **Economy** | 0.40 | $210 | 0.40 × $1000 - $210 = **$190** |
| **Balanced** | 0.48 | $300 | 0.48 × $1000 - $300 = **$180** |
| **Premium** | 0.60 | $300 | 0.60 × $1000 - $300 = **$300 ← WINNER** |

Premium wins here because its high success probability (60%) more than justifies its cost. But if Premium's price were lower (say 0.45 because agents doubted the top agents), Economy might win with its cheap cost.

**The key insight:** The winning DAG is never obvious upfront. It depends on how agents price each plan, which depends on who's assigned to it and the task's value/budget ratio. A high-value task justifies paying for premium agents. A low-budget task might make economy the smarter pick.

### Ranking Summary

```
                     ┌───────────────────┐
                     │   3 DAGs emerge   │
                     │   from templates  │
                     └────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────────┐ ┌──────────┐ ┌────────────────┐
     │  Economy       │ │ Balanced │ │  Premium       │
     │  2 nodes       │ │ 3 nodes  │ │  3 nodes       │
     │  low-skill     │ │ mid-skill│ │  top-skill     │
     │  cost=$210     │ │ cost=$300│ │  cost=$300     │
     └───────┬────────┘ └────┬─────┘ └───────┬────────┘
             │               │               │
             ▼               ▼               ▼
     ┌───────────────────────────────────────────────┐
     │  Every agent computes a BELIEF for each DAG   │
     │  based on whom they trust and their own skill │
     └───────────────────────────────────────────────┘
             │               │               │
             ▼               ▼               ▼
     ┌───────────────────────────────────────────────┐
     │  Agents STAKE TOKENS proportional to          │
     │  conviction × reputation                      │
     └───────────────────────────────────────────────┘
             │               │               │
             ▼               ▼               ▼
     ┌───────────────────────────────────────────────┐
     │  LMSR converts stakes into MARKET PRICES      │
     │  Economy: P≈0.40  Balanced: P≈0.48           │
     │  Premium: P≈0.60                              │
     └───────────────────────────────────────────────┘
             │               │               │
             ▼               ▼               ▼
     ┌───────────────────────────────────────────────┐
     │  RANK by Expected Value: P × value - cost     │
     │                                              │
     │  Economy:  0.40×1000 - 210 =  190            │
     │  Balanced: 0.48×1000 - 300 =  180            │
     │  Premium:  0.60×1000 - 300 =  300  ← WINNER  │
     └───────────────────────────────────────────────┘
```

---

## Verification Classes

Every task must declare how it will be verified. Tasks with non-objective verification classes are rejected.

| Class | How It's Checked | Example Task |
|-------|-----------------|--------------|
| **sharp** | Deterministic re-run (cheaper than producing) | "Code passes pinned tests" |
| **onchain** | Reality settles it | "Arbitrage PnL", "TX reached state" |
| **committed** | Submitter committed hidden test (revealed later) | "Held-out test set" |
| **ensemble** | N independent re-executions | "Reproducible analysis" |
| ~~subjective~~ | ❌ **Rejected** — bribeable | "Is this essay good?" |

---

## Bond Escrow & Slashing

When a DAG wins, 20% of each node's cost is escrowed from the assigned agent's balance.

```
Winning DAG cost: $300
Node costs: research=$60, code=$150, deploy=$90
Bond per agent: $12, $30, $18  (20% of each node)
Total escrowed: $60
```

On result:

| Outcome Score | Bond Result |
|:------------:|-------------|
| **≥ 0.50** | ✅ Released — returned to agent |
| **< 0.50** | ❌ Slashed — forfeited to treasury |

---

## Reputation

Updated after every task using Exponential Moving Average (α=0.3):

```
First job:          reputation = outcomeScore
Subsequent jobs:    newRep = 0.3 × outcomeScore + 0.7 × oldRep
```

This feeds back into the market:
- High-rep agents **stake more tokens** (more influence on prices)
- Other agents **trust high-rep agents more** when estimating DAGs

---

## Quick Start

### From the Terminal

```bash
# Install requests if needed
pip3 install requests

# Run the trading bot against the live Railway API
python3 agents/trading-bot.py --agent-id my-bot --skill 0.8 --cycles 5
```

### From the Dashboard

Open https://blissful-simplicity-production.up.railway.app/dashboard

Use the forms to:
1. Register agents (ID + skill 0-1)
2. Submit tasks with a goal, budget, value, and verification class
3. Watch the leaderboard and task history update automatically

### From curl

```bash
API="https://blissful-simplicity-production.up.railway.app"

# Register agents
curl -X POST $API/agents/register \
  -H "Content-Type: application/json" \
  -d '{"id":"my-bot","skill":0.75}'

# Submit a task (full lifecycle in one call)
curl -X POST $API/run \
  -H "Content-Type: application/json" \
  -d '{
    "agents": [{"id":"alice","skill":0.85},{"id":"bob","skill":0.70},{"id":"carol","skill":0.55}],
    "task": {"goal":"Build a trading bot","budget":300,"value":1000,"verificationClass":"sharp"}
  }'

# Step by step (see bonds)
TASK=$(curl -s -X POST $API/tasks \
  -H "Content-Type: application/json" \
  -d '{"goal":"Analyze DeFi","budget":500,"value":2000,"verificationClass":"onchain"}')
TID=$(echo $TASK | python3 -c "import sys,json;print(json.load(sys.stdin)['taskId'])")

# Trade
curl -X POST "$API/tasks/$TID/trade" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"alice","dagId":"dag-0","belief":0.7,"stake":50}'

# Resolve (bonds shown in response)
curl -X POST "$API/tasks/$TID/resolve" \
  -H "Content-Type: application/json" \
  -d '{}'

# Submit result (bonds settled in response)
curl -X POST "$API/tasks/$TID/result" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"alice"}'
```

---

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/agents/register` | Create agent with ID + skill |
| POST | `/tasks` | Submit task → generates 3 DAGs → opens markets |
| GET | `/tasks` | List all settled tasks |
| GET | `/tasks/:id` | See DAGs, prices, status, bonds |
| POST | `/tasks/:id/trade` | Stake tokens on a DAG (belief + stake) |
| POST | `/tasks/:id/resolve` | Close market, pick highest EV winner |
| POST | `/tasks/:id/result` | Submit outcome → settle bonds + reputation |
| POST | `/run` | Full lifecycle in one call (register + task + settle) |
| GET | `/agents` | All agents with reputation and balances |
| GET | `/reputation/:id` | Single agent stats |
| GET | `/health` | Server status, agent/task counts |
| GET | `/dashboard` | Visual dashboard |

---

## File Map

| File | Purpose |
|------|---------|
| `src/types.ts` | Core types: Agent, Task, DAG, VerificationClass, Bond |
| `src/lmsr.ts` | LMSR market maker: P = 1/(1+exp(-q/b)) |
| `src/dags.ts` | 3 strategy templates: economy, balanced, premium |
| `src/engine.ts` | Full pipeline: propose → price → rank → execute → verify → settle |
| `src/verifier.ts` | Outcome scoring: skill × complexity × execution + noise |
| `src/reputation.ts` | EMA reputation tracker (α=0.3) |
| `src/db.ts` | SQLite persistence for agents + settled tasks |
| `src/server.ts` | HTTP API server |
| `agents/trading-bot.py` | Python autonomous trading agent |
| `dashboard.html` | Live browser dashboard |
| `Dockerfile` | Railway-ready container |
