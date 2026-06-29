/**
 * db.ts — SQLite persistence for the AEX Scaffold.
 *
 * Uses Bun's built-in bun:sqlite. Zero dependencies.
 * Stores agents and settled tasks so data survives server restarts.
 *
 * Open/in-progress tasks are not persisted — they expire on restart.
 */

import { Database } from "bun:sqlite";
import type { Agent, DAG, Task } from "./types";

export interface StoredAgent extends Agent {
  balance: number;
}

export interface StoredTask {
  id: string;
  task: Task;
  status: string;
  dags: DAG[];
  winnerId: string | null;
  winnerEV: number | null;
  outcomeScore: number | null;
  completed: boolean | null;
  prices: Record<string, number>;
  createdAt: string;
}

let db: Database;

export function initDB(path: string = "aex-scaffold.db"): void {
  db = new Database(path);

  // Enable WAL mode for concurrent reads
  db.run("PRAGMA journal_mode=WAL");

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id        TEXT PRIMARY KEY,
      skill     REAL NOT NULL,
      reputation REAL NOT NULL DEFAULT 0.5,
      jobs      INTEGER NOT NULL DEFAULT 0,
      balance   REAL NOT NULL DEFAULT 1000
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                TEXT PRIMARY KEY,
      goal              TEXT NOT NULL,
      budget            REAL NOT NULL,
      value             REAL NOT NULL,
      latency_target    TEXT NOT NULL DEFAULT 'normal',
      verification_level TEXT NOT NULL DEFAULT 'standard',
      status            TEXT NOT NULL DEFAULT 'settled',
      winner_id         TEXT,
      winner_ev         REAL,
      outcome_score     REAL,
      completed         INTEGER,
      dags_json         TEXT NOT NULL,
      prices_json       TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// ── Agents ──────────────────────────────────────────────────

export function saveAgent(agent: StoredAgent): void {
  db.run(
    `INSERT OR REPLACE INTO agents (id, skill, reputation, jobs, balance)
     VALUES (?, ?, ?, ?, ?)`,
    [agent.id, agent.skill, agent.reputation, agent.jobs, agent.balance],
  );
}

export function getAgent(id: string): StoredAgent | null {
  const row = db.query(`SELECT * FROM agents WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    skill: row.skill,
    reputation: row.reputation,
    jobs: row.jobs,
    balance: row.balance,
  };
}

export function getAllAgents(): StoredAgent[] {
  const rows = db.query(`SELECT * FROM agents ORDER BY reputation DESC`).all() as any[];
  return rows.map((r) => ({
    id: r.id,
    skill: r.skill,
    reputation: r.reputation,
    jobs: r.jobs,
    balance: r.balance,
  }));
}

export function agentExists(id: string): boolean {
  const row = db.query(`SELECT 1 FROM agents WHERE id = ?`).get(id);
  return !!row;
}

// ── Tasks ───────────────────────────────────────────────────

export function saveTask(record: {
  id: string;
  task: Task;
  status: string;
  dags: DAG[];
  winnerId: string | null;
  winnerEV: number | null;
  outcomeScore: number | null;
  completed: boolean | null;
  prices: Record<string, number>;
}): void {
  db.run(
    `INSERT OR REPLACE INTO tasks
     (id, goal, budget, value, latency_target, verification_level,
      status, winner_id, winner_ev, outcome_score, completed,
      dags_json, prices_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.task.goal,
      record.task.budget,
      record.task.value,
      record.task.latencyTarget,
      record.task.verificationLevel,
      record.status,
      record.winnerId,
      record.winnerEV,
      record.outcomeScore,
      record.completed !== null ? (record.completed ? 1 : 0) : null,
      JSON.stringify(record.dags),
      JSON.stringify(record.prices),
    ],
  );
}

export function getTask(id: string): StoredTask | null {
  const row = db.query(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    task: {
      id: row.id,
      goal: row.goal,
      budget: row.budget,
      value: row.value,
      latencyTarget: row.latency_target,
      verificationLevel: row.verification_level,
    },
    status: row.status,
    dags: JSON.parse(row.dags_json),
    winnerId: row.winner_id,
    winnerEV: row.winner_ev,
    outcomeScore: row.outcome_score,
    completed: row.completed === null ? null : row.completed === 1,
    prices: JSON.parse(row.prices_json),
    createdAt: row.created_at,
  };
}

export function getAllTasks(): StoredTask[] {
  const rows = db.query(`SELECT * FROM tasks ORDER BY created_at DESC`).all() as any[];
  return rows.map((r) => ({
    id: r.id,
    task: {
      id: r.id,
      goal: r.goal,
      budget: r.budget,
      value: r.value,
      latencyTarget: r.latency_target,
      verificationLevel: r.verification_level,
    },
    status: r.status,
    dags: JSON.parse(r.dags_json),
    winnerId: r.winner_id,
    winnerEV: r.winner_ev,
    outcomeScore: r.outcome_score,
    completed: r.completed === null ? null : r.completed === 1,
    prices: JSON.parse(r.prices_json),
    createdAt: r.created_at,
  }));
}

export function closeDB(): void {
  if (db) db.close();
}
