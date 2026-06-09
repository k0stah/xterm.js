import {
  addDecimal,
  decimalToNumber,
  subtractDecimal,
  toDecimal,
} from "./decimal.js";
import {
  deriveInstruments,
  FALLBACK_ANCHORS,
  precisionForSymbol,
  type AnchorRate,
  type ForexSymbol,
  type MarketStatus,
  type Quote,
} from "./market.js";

type SimulationConfig = {
  seed?: string;
  tickIntervalMs?: number;
  meanReversion?: number;
  volatilityMultiplier?: number;
  staleAfterSeconds?: number;
};

const PAIR_CONFIG: Record<ForexSymbol, { spreadPips: number; volatility: number }> = {
  "EUR/USD": { spreadPips: 1.8, volatility: 0.00011 },
  "GBP/USD": { spreadPips: 2.2, volatility: 0.00014 },
  "USD/JPY": { spreadPips: 2.1, volatility: 0.00012 },
  "USD/CHF": { spreadPips: 2.0, volatility: 0.00012 },
  "EUR/GBP": { spreadPips: 2.0, volatility: 0.0001 },
  "EUR/JPY": { spreadPips: 2.4, volatility: 0.00013 },
};

export class MarketSimulationEngine {
  private readonly _seedIdentifier: string;
  private readonly _random: () => number;
  private readonly _meanReversion: number;
  private readonly _volatilityMultiplier: number;
  private readonly _staleAfterSeconds: number;
  private _anchors: AnchorRate[];
  private _anchorStale = false;
  private _prices = new Map<ForexSymbol, number>();
  private _latestTickTimestamp: string | null = null;
  private _volatilityEventTicks = 0;

  constructor(anchors = FALLBACK_ANCHORS, config: SimulationConfig = {}) {
    this._anchors = anchors;
    this._seedIdentifier = config.seed ?? "local-default";
    this._random = createSeededRandom(hashSeed(this._seedIdentifier));
    this._meanReversion = config.meanReversion ?? 0.025;
    this._volatilityMultiplier = config.volatilityMultiplier ?? 1;
    this._staleAfterSeconds = config.staleAfterSeconds ?? 36 * 60 * 60;
    this.resetToAnchors(anchors, false);
  }

  resetToAnchors(anchors: AnchorRate[], stale: boolean): void {
    this._anchors = anchors;
    this._anchorStale = stale;
    for (const instrument of deriveInstruments(anchors)) {
      this._prices.set(instrument.symbol, decimalToNumber(instrument.anchorMid));
    }
  }

  markAnchorsStale(stale: boolean): void {
    this._anchorStale = stale;
  }

  tick(now = new Date()): Quote[] {
    const timestamp = now.toISOString();
    const instruments = deriveInstruments(this._anchors);
    if (this._random() < 0.012) {
      this._volatilityEventTicks = 6 + Math.floor(this._random() * 8);
    }
    const eventMultiplier = this._volatilityEventTicks > 0 ? 2.4 : 1;
    if (this._volatilityEventTicks > 0) {
      this._volatilityEventTicks -= 1;
    }

    const quotes = instruments.map((instrument) => {
      const current = this._prices.get(instrument.symbol) ?? decimalToNumber(instrument.anchorMid);
      const anchor = decimalToNumber(instrument.anchorMid);
      const config = PAIR_CONFIG[instrument.symbol];
      const movement =
        current * gaussian(this._random) * config.volatility * this._volatilityMultiplier * eventMultiplier;
      const reversion = (anchor - current) * this._meanReversion;
      const next = Math.max(anchor * 0.5, current + movement + reversion);
      this._prices.set(instrument.symbol, next);

      const spread = spreadFor(instrument.symbol, eventMultiplier);
      const halfSpread = spread / 2;
      const bid = Math.max(next - halfSpread, next * 0.0001);
      const ask = Math.max(next + halfSpread, bid + spread);
      return {
        symbol: instrument.symbol,
        bid: toDecimal(bid.toFixed(instrument.precision + 3), instrument.precision),
        ask: toDecimal(ask.toFixed(instrument.precision + 3), instrument.precision),
        mid: toDecimal(next.toFixed(instrument.precision + 3), instrument.precision),
        spread: toDecimal((ask - bid).toFixed(instrument.precision + 3), instrument.precision),
        timestamp,
        source: "simulated" as const,
        anchorSource: "ECB" as const,
        anchorDate: this.anchorObservationDate() ?? "",
        anchorStale: this.isAnchorStale(now),
      };
    });

    this._latestTickTimestamp = timestamp;
    return quotes.map((quote) => enforceBidAskInvariant(quote));
  }

  snapshot(now = new Date()): Quote[] {
    if (!this._latestTickTimestamp) {
      return this.tick(now);
    }
    const timestamp = now.toISOString();
    return deriveInstruments(this._anchors).map((instrument) => {
      const current = this._prices.get(instrument.symbol) ?? decimalToNumber(instrument.anchorMid);
      const spread = spreadFor(instrument.symbol, this._volatilityEventTicks > 0 ? 2.4 : 1);
      const halfSpread = spread / 2;
      return enforceBidAskInvariant({
        symbol: instrument.symbol,
        bid: toDecimal((current - halfSpread).toFixed(instrument.precision + 3), instrument.precision),
        ask: toDecimal((current + halfSpread).toFixed(instrument.precision + 3), instrument.precision),
        mid: toDecimal(current.toFixed(instrument.precision + 3), instrument.precision),
        spread: toDecimal(spread.toFixed(instrument.precision + 3), instrument.precision),
        timestamp,
        source: "simulated",
        anchorSource: "ECB",
        anchorDate: this.anchorObservationDate() ?? "",
        anchorStale: this.isAnchorStale(now),
      });
    });
  }

  quote(symbol: ForexSymbol): Quote {
    const quote = this.snapshot().find((candidate) => candidate.symbol === symbol);
    if (!quote) {
      throw new Error(`Unsupported symbol ${symbol}.`);
    }
    return quote;
  }

  status(now = new Date()): MarketStatus {
    const retrievedAt = this.latestRetrievalTimestamp();
    return {
      simulatorStatus: this._anchors.length ? "running" : "degraded",
      latestTickTimestamp: this._latestTickTimestamp,
      ecbAnchorObservationDate: this.anchorObservationDate(),
      ecbRetrievalTimestamp: retrievedAt,
      anchorAgeSeconds: retrievedAt
        ? Math.max(0, Math.floor((now.getTime() - new Date(retrievedAt).getTime()) / 1000))
        : null,
      anchorStale: this.isAnchorStale(now),
      simulationSeedIdentifier:
        process.env.NODE_ENV === "production" ? null : this._seedIdentifier,
    };
  }

  anchors(): AnchorRate[] {
    return this._anchors;
  }

  private anchorObservationDate(): string | null {
    return this._anchors[0]?.observationDate ?? null;
  }

  private latestRetrievalTimestamp(): string | null {
    return this._anchors[0]?.retrievedAt ?? null;
  }

  private isAnchorStale(now: Date): boolean {
    if (this._anchorStale) {
      return true;
    }
    const retrievedAt = this.latestRetrievalTimestamp();
    if (!retrievedAt) {
      return true;
    }
    return now.getTime() - new Date(retrievedAt).getTime() > this._staleAfterSeconds * 1000;
  }
}

function spreadFor(symbol: ForexSymbol, multiplier: number): number {
  const pip = symbol.endsWith("/JPY") ? 0.01 : 0.0001;
  return PAIR_CONFIG[symbol].spreadPips * pip * multiplier;
}

function enforceBidAskInvariant(quote: Quote): Quote {
  if (Number(quote.bid) < Number(quote.mid) && Number(quote.mid) < Number(quote.ask)) {
    return quote;
  }
  const precision = precisionForSymbol(quote.symbol);
  const spread = quote.spread;
  const halfSpread = Number(spread) / 2;
  const mid = Number(quote.mid);
  return {
    ...quote,
    bid: subtractDecimal(toDecimal(mid, precision), toDecimal(halfSpread, precision), precision),
    ask: addDecimal(toDecimal(mid, precision), toDecimal(halfSpread, precision), precision),
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
