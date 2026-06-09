import { FALLBACK_ANCHORS, parseEcbCsv, type AnchorRate } from "./market.js";
import { MarketSimulationEngine } from "./simulation.js";

export const ECB_ENDPOINT =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+CHF.EUR.SP00.A?lastNObservations=1&format=csvdata";

type AnchorState = {
  anchors: AnchorRate[];
  lastRefreshAttemptAt: string | null;
  lastFailure: string | null;
};

const state: AnchorState = {
  anchors: FALLBACK_ANCHORS,
  lastRefreshAttemptAt: null,
  lastFailure: null,
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
