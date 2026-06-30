#!/usr/bin/env python3
"""
AEX Scaffold — Autonomous Trading Agent

Participates in the AEX execution market: registers, posts tasks,
trades on strategies, resolves markets, and submits results.

Usage:
  python3 agents/trading-bot.py --agent-id zak-bot --skill 0.75 --cycles 5
"""

import argparse
import random
import sys
import time

import requests

BASE_URL = "https://blissful-simplicity-production.up.railway.app"

GOALS = [
    "Analyze DeFi liquidity pools",
    "Build a rebalancing schedule",
    "Optimize gas costs on L2",
    "Design a stop-loss strategy",
    "Backtest mean reversion on ETH",
    "Simulate a governance attack",
    "Audit a lending protocol",
    "Build a MEV bot strategy",
]


def api_get(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=10)
    r.raise_for_status()
    return r.json()


def api_post(path, body):
    r = requests.post(f"{BASE_URL}{path}", json=body, timeout=10)
    return r.json()


def short(d, *keys):
    if not isinstance(d, dict):
        return str(d)[:120]
    if keys:
        return {k: d.get(k) for k in keys if d.get(k) is not None}
    return d


def run(agent_id, skill, cycles):
    print(f"\n{'='*55}")
    print(f"  AGENT: {agent_id}  |  skill={skill}")
    print(f"  API:   {BASE_URL}")
    print(f"{'='*55}\n")

    # Register
    r = api_post("/agents/register", {"id": agent_id, "skill": skill})
    print(f"[1/5] Registered   → {short(r, 'id', 'skill', 'balance')}")

    for c in range(1, cycles + 1):
        print(f"\n── Cycle {c}/{cycles} ──")

        # Post a task
        goal = random.choice(GOALS)
        budget = random.randint(200, 800)
        value = budget * random.randint(2, 5)
        t = api_post("/tasks", {"goal": goal, "budget": budget, "value": value})
        task_id = t.get("taskId") or t.get("id")
        print(f"[2/5] Posted task  → {task_id}: \"{goal}\" (budget={budget}, value={value})")
        if not task_id:
            continue
        time.sleep(1)

        # Read market (DAGs)
        market = api_get(f"/tasks/{task_id}")
        dags = market.get("dags", [])
        if not isinstance(dags, list) or not dags:
            print(f"[3/5] Market       → status={market.get('status')}, no DAGs found")
            continue
        print(f"[3/5] Market       → {len(dags)} DAGs available, status={market.get('status')}")

        # Trade on a random DAG
        dag = random.choice(dags)
        dag_id = dag["id"]
        strategy = dag.get("strategy", "?")
        stake = random.randint(30, 150)
        tr = api_post(f"/tasks/{task_id}/trade", {
            "agentId": agent_id,
            "dagId": dag_id,
            "stake": stake,
        })
        print(f"[4/5] Trade        → {stake} on {dag_id} ({strategy})  price now={tr.get('newPrice','?')}  balance={tr.get('remainingBalance','?')}")
        time.sleep(1)

        # Resolve
        rr = api_post(f"/tasks/{task_id}/resolve", {})
        winner = rr.get("winner")
        print(f"[5/5] Resolve      → {short(rr, 'status', 'message')}")

        if isinstance(winner, dict) and winner.get("dagId"):
            time.sleep(0.5)
            score = round(random.uniform(0.3, 0.95), 2)
            sr = api_post(f"/tasks/{task_id}/result", {
                "agentId": agent_id,
                "score": score,
            })
            print(f"      Result      → score={score}  {short(sr.get('outcome', {}))}  rep={short(sr.get('reputationChanges'))}")

        # Check reputation
        rep = api_get(f"/reputation/{agent_id}")
        print(f"      Reputation  → {short(rep, 'agentId', 'reputation', 'tasksWon', 'totalTasks')}")

        time.sleep(2)

    print(f"\n{'='*55}")
    rep = api_get(f"/reputation/{agent_id}")
    print(f"  {agent_id} final: {short(rep, 'agentId', 'reputation', 'tasksWon', 'totalTasks', 'balance')}")
    print(f"{'='*55}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent-id", default="trader-bot")
    parser.add_argument("--skill", type=float, default=0.7)
    parser.add_argument("--cycles", type=int, default=5)
    args = parser.parse_args()

    try:
        h = api_get("/health")
        print(f"✓ Connected — {h.get('agents')} agents, {h.get('tasks')} tasks, {h.get('openTasks')} open")
    except Exception as e:
        print(f"✗ Can't reach {BASE_URL}: {e}")
        sys.exit(1)

    run(args.agent_id, args.skill, args.cycles)


if __name__ == "__main__":
    main()
