import {
  deriveHistoricalPricePoints,
  FALLBACK_ANCHORS,
  parseEcbCsv,
  parseEcbHistoricalCsv,
  type AnchorRate,
  type HistoricalPricePoint,
} from "./market.js";
import { MarketSimulationEngine } from "./simulation.js";

export const ECB_ENDPOINT =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+CHF.EUR.SP00.A?lastNObservations=1&format=csvdata";
const ECB_HISTORY_ENDPOINT =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+CHF.EUR.SP00.A";
const DefaultHistoryDays = 45;
const HistoryCacheSeconds = 6 * 60 * 60;

type AnchorState = {
  anchors: AnchorRate[];
  lastRefreshAttemptAt: string | null;
  lastFailure: string | null;
};

type HistoryState = {
  days: number;
  lastFailure: string | null;
  retrievedAt: string | null;
  points: HistoricalPricePoint[];
};

const state: AnchorState = {
  anchors: FALLBACK_ANCHORS,
  lastRefreshAttemptAt: null,
  lastFailure: null,
};

const historyState: HistoryState = {
  days: DefaultHistoryDays,
  lastFailure: null,
  points: [],
  retrievedAt: null,
};

const engine = new MarketSimulationEngine(state.anchors, {
  seed: process.env.FOREX_RANDOM_SEED ?? "aster-ecb-simulator",
  tickIntervalMs: Number(process.env.FOREX_TICK_INTERVAL_MS ?? 1000),
  meanReversion: Number(process.env.FOREX_ANCHOR_MEAN_REVERSION ?? 0.025),
  volatilityMultiplier: Number(process.env.FOREX_VOLATILITY_MULTIPLIER ?? 1),
  staleAfterSeconds: Number(process.env.FOREX_ANCHOR_STALE_AFTER_SECONDS ?? 36 * 60 * 60),
});

export function getMarketEngine(): MarketSimulationEngine {
  return engine;
}

export function getAnchorState(): AnchorState {
  return state;
}

export function getHistoryState(): HistoryState {
  return historyState;
}

export async function refreshEcbAnchors(fetcher: typeof fetch = fetch): Promise<AnchorRate[]> {
  state.lastRefreshAttemptAt = new Date().toISOString();
  try {
    const response = await fetcher(process.env.ECB_API_BASE_URL ?? ECB_ENDPOINT, {
      headers: { Accept: "text/csv,*/*" },
    });
    if (!response.ok) {
      throw new Error(`ECB returned HTTP ${response.status}.`);
    }
    const text = await response.text();
    const anchors = parseEcbCsv(text, new Date().toISOString());
    state.anchors = anchors;
    state.lastFailure = null;
    engine.resetToAnchors(anchors, false);
    return anchors;
  } catch (error) {
    state.lastFailure = error instanceof Error ? error.message : "ECB refresh failed.";
    engine.markAnchorsStale(true);
    console.warn("forex.ecb_refresh_failed", {
      message: state.lastFailure,
      retainedAnchorDate: state.anchors[0]?.observationDate,
    });
    return state.anchors;
  }
}

export async function getHistoricalPrices(
  days = DefaultHistoryDays,
  fetcher: typeof fetch = fetch,
): Promise<HistoricalPricePoint[]> {
  const boundedDays = Math.max(31, Math.min(120, Math.floor(days)));
  if (
    historyState.points.length &&
    historyState.days >= boundedDays &&
    historyState.retrievedAt &&
    Date.now() - new Date(historyState.retrievedAt).getTime() < HistoryCacheSeconds * 1000
  ) {
    return historyState.points;
  }

  const now = new Date();
  const endPeriod = dateOnly(now);
  const startPeriod = dateOnly(new Date(now.getTime() - boundedDays * 24 * 60 * 60 * 1000));
  const url = new URL(process.env.ECB_HISTORY_API_BASE_URL ?? ECB_HISTORY_ENDPOINT);
  url.searchParams.set("startPeriod", startPeriod);
  url.searchParams.set("endPeriod", endPeriod);
  url.searchParams.set("format", "csvdata");

  try {
    const response = await fetcher(url.toString(), {
      headers: { Accept: "text/csv,*/*" },
    });
    if (!response.ok) {
      throw new Error(`ECB historical data returned HTTP ${response.status}.`);
    }

    const text = await response.text();
    const retrievedAt = new Date().toISOString();
    const points = deriveHistoricalPricePoints(parseEcbHistoricalCsv(text, retrievedAt));
    historyState.days = boundedDays;
    historyState.lastFailure = null;
    historyState.points = points;
    historyState.retrievedAt = retrievedAt;
    return points;
  } catch (error) {
    historyState.lastFailure = error instanceof Error ? error.message : "ECB historical data refresh failed.";
    console.warn("forex.ecb_history_refresh_failed", {
      message: historyState.lastFailure,
    });
    return historyState.points;
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
