import { env } from "cloudflare:workers";
import {
  getMarketEngine,
  refreshEcbAnchors,
} from "./singleton.js";
import {
  isSupportedSymbol,
  normalizeSymbol,
  SUPPORTED_SYMBOLS,
  type ForexSymbol,
  type Quote,
} from "./market.js";
import type { D1DatabaseLike } from "./repository.js";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export function getUserId(request: Request): string {
  const email = request.headers.get("oai-authenticated-user-email");
  if (email?.trim()) {
    return email.trim().toLowerCase();
  }
  if (process.env.NODE_ENV !== "production") {
    return request.headers.get("x-local-user")?.trim().toLowerCase() || "local-demo@example.test";
  }
  throw responseError("UNAUTHENTICATED", "Authentication is required.", 401);
}

export function getD1(): D1DatabaseLike {
  const workerEnv = env as unknown as { DB?: D1DatabaseLike };
  if (!workerEnv.DB) {
    throw responseError(
      "DATABASE_UNAVAILABLE",
      "D1 binding `DB` is unavailable. Apply the site D1 binding and migration before using account APIs.",
      503,
    );
  }
  return workerEnv.DB;
}

export function responseError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
) {
  const error = new Error(message) as Error & {
    code: string;
    status: number;
    details?: Record<string, unknown>;
  };
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

export function jsonError(error: unknown): Response {
  if (error instanceof Error && "code" in error && "status" in error) {
    const routed = error as Error & { code: string; status: number; details?: Record<string, unknown> };
    return Response.json(
      {
        type: "error",
        code: routed.code,
        message: routed.message,
        details: routed.details,
      },
      { status: routed.status },
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  const migrationHint =
    message.includes("no such table") || message.includes("D1_ERROR")
      ? "Run the D1 migration in drizzle/0000_forex_simulator.sql."
      : undefined;
  return Response.json(
    {
      type: "error",
      code: "INTERNAL_ERROR",
      message,
      details: migrationHint ? { migrationHint } : undefined,
    },
    { status: 500 },
  );
}

export function pricesBySymbol(): Partial<Record<ForexSymbol, Quote>> {
  return Object.fromEntries(
    getMarketEngine().snapshot().map((quote) => [quote.symbol, quote]),
  ) as Partial<Record<ForexSymbol, Quote>>;
}

export async function maybeRefreshAnchors(): Promise<void> {
  const status = getMarketEngine().status();
  const refreshEverySeconds = Number(process.env.ECB_REFRESH_INTERVAL_SECONDS ?? 6 * 60 * 60);
  if (
    !status.ecbRetrievalTimestamp ||
    Date.now() - new Date(status.ecbRetrievalTimestamp).getTime() > refreshEverySeconds * 1000
  ) {
    await refreshEcbAnchors();
  }
}

export function parseSymbolsFromRequest(request: Request): ForexSymbol[] {
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols") ?? url.searchParams.get("instruments") ?? SUPPORTED_SYMBOLS.join(",");
  const symbols = raw
    .split(",")
    .map(normalizeSymbol)
    .filter(Boolean);
  const unique = [...new Set(symbols)];
  const max = Number(process.env.FOREX_MAX_SYMBOLS_PER_CONNECTION ?? 12);
  if (unique.length > max) {
    throw responseError(
      "SUBSCRIPTION_LIMIT_EXCEEDED",
      `At most ${max} symbols may be subscribed at once.`,
      400,
    );
  }
  const unsupported = unique.find((symbol) => !isSupportedSymbol(symbol));
  if (unsupported) {
    throw responseError(
      "UNSUPPORTED_SYMBOL",
      "The requested symbol is not supported.",
      400,
      { symbol: unsupported },
    );
  }
  return unique as ForexSymbol[];
}

export function publicQuote(quote: Quote) {
  return {
    symbol: quote.symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid: quote.mid,
    spread: quote.spread,
    timestamp: quote.timestamp,
    source: quote.source,
    anchor_source: quote.anchorSource,
    anchor_date: quote.anchorDate,
    anchor_stale: quote.anchorStale,
  };
}
