/**
 * lmsr.ts — Logarithmic Market Scoring Rule (LMSR) market maker.
 *
 * WHAT IS LMSR?
 * LMSR is an automated market maker for binary prediction markets.
 * Instead of an order book (which needs liquidity), LMSR provides
 * continuous pricing from any single trade.
 *
 * THE FORMULA:
 *   P(success) = 1 / (1 + exp(-q / b))
 *
 * Where:
 *   q = net quantity (tokens wagered on YES minus tokens wagered on NO)
 *   b = liquidity parameter (higher b = deeper market, less price impact per token)
 *
 * HOW AN AGENT TRADES:
 *   1. Agent forms a personal belief about P(success) (e.g. 0.8)
 *   2. If belief > current market price → buy YES (push price up toward belief)
 *   3. If belief < current market price → buy NO (push price down toward belief)
 *   4. The amount they stake determines how far the price moves
 *
 * WHY THIS MATTERS:
 * Agents put capital behind their beliefs. An agent who thinks
 * the market price is wrong can profit by trading — and in doing
 * so, moves the price toward the correct probability.
 * The market price = the capital-weighted consensus of all agents.
 */

/** LMSR market state for a single DAG. */
interface MarketState {
  /** Net quantity (YES - NO tokens). Positive = bullish consensus. */
  q: number;
  /** Liquidity parameter — higher = smoother curve, less price impact. */
  b: number;
  /** Number of trades placed. */
  trades: number;
}

/** Manages LMSR markets for a set of DAGs. */
export class LMSRMarket {
  private markets = new Map<string, MarketState>();

  /** Open a new market for a DAG with maximum uncertainty (P=0.5). */
  open(dagId: string, liquidity: number = 100): void {
    this.markets.set(dagId, { q: 0, b: liquidity, trades: 0 });
  }

  /** Current probability of success for a DAG (0-1). */
  price(dagId: string): number {
    const m = this.markets.get(dagId);
    if (!m) return 0.5;
    return 1 / (1 + Math.exp(-m.q / Math.max(m.b, 1)));
  }

  /**
   * An agent trades on a DAG's success market.
   *
   * The agent stakes tokens behind their belief. If they're right
   * (belief is closer to reality than the market was), they profit.
   * If they're wrong, they lose their stake.
   *
   * @param dagId — the DAG being traded
   * @param belief — the agent's personal probability estimate (0-1)
   * @param stake — tokens the agent puts at risk (higher = more price impact)
   * @returns the new price after this trade
   */
  trade(dagId: string, belief: number, stake: number): number {
    const m = this.markets.get(dagId);
    if (!m) return 0.5;

    const current = this.price(dagId);
    // If belief > current price → buy YES (q increases)
    // If belief < current price → buy NO (q decreases)
    const direction = belief > current ? 1 : -1;
    const delta = direction * stake;
    m.q += delta;
    m.trades++;

    // Prevent floating-point blowup — cap q at ±500
    // (at q=500 with b=100, P ≈ 0.993 — effectively certain)
    // (at q=-500 with b=100, P ≈ 0.007 — effectively impossible)
    m.q = Math.max(-500, Math.min(500, m.q));
    return this.price(dagId);
  }

  /** Summary of all market states. */
  snapshot(): Array<{ dagId: string; price: number; trades: number }> {
    return Array.from(this.markets.entries()).map(([dagId, m]) => ({
      dagId,
      price: this.price(dagId),
      trades: m.trades,
    }));
  }
}
