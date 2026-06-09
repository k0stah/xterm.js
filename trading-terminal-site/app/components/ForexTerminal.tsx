"use client";

import { useEffect, useMemo, useState } from "react";
import {
  appendLivePricePoint,
  aggregateCandlesForInterval,
  CHART_INTERVALS,
  type ChartInterval,
  type PricePoint,
  marketRangeForWindow,
} from "../../lib/forex/chart";

const SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "EUR/GBP", "EUR/JPY"] as const;
type SymbolName = (typeof SYMBOLS)[number];
type FeedStatus = "connecting" | "live" | "stale" | "disconnected";

type Quote = {
  symbol: SymbolName;
  bid: string;
  ask: string;
  mid: string;
  spread: string;
  timestamp: string;
  source: "simulated";
  anchor_source: "ECB";
  anchor_date: string;
  anchor_stale: boolean;
};

type AccountSummary = {
  cashBalanceUsd: string;
  equityUsd: string;
  realizedPnlUsd: string;
  unrealizedPnlUsd: string;
};

type Position = {
  symbol: SymbolName;
  side: "long" | "short" | "flat";
  quantity: string;
  averageEntryPrice: string;
  unrealizedPnlUsd: string;
};

type Trade = {
  id: string;
  symbol: SymbolName;
  side: "buy" | "sell";
  quantity: string;
  execution_price: string;
  realized_pnl_usd: string;
  executed_at: string;
};

type Tick = {
  symbol: SymbolName;
  time: string;
  side: "Up" | "Down";
  mid: string;
  spread: string;
};

type HistoricalPayloadPoint = {
  symbol: SymbolName;
  timestamp: string;
  mid: string;
  source: "ECB";
  anchor_date: string;
};

const ChartSize = {
  Width: 760,
  Height: 250,
  Padding: 16,
} as const;

const MaxHistoryPoints = 540;
const MarketStatsWindowMs = 24 * 60 * 60 * 1000;

const chartIntervalCandles: Record<ChartInterval, number> = {
  "1min": 28,
  "5min": 22,
  "10min": 18,
  "30min": 14,
  "1h": 11,
  "6h": 8,
  "1d": 31,
  "1w": 8,
};

const seededQuotes: Record<SymbolName, Quote> = {
  "EUR/USD": seedQuote("EUR/USD", "1.15400", "0.00018"),
  "GBP/USD": seedQuote("GBP/USD", "1.37055", "0.00022"),
  "USD/JPY": seedQuote("USD/JPY", "144.021", "0.021"),
  "USD/CHF": seedQuote("USD/CHF", "0.81109", "0.00020"),
  "EUR/GBP": seedQuote("EUR/GBP", "0.84200", "0.00020"),
  "EUR/JPY": seedQuote("EUR/JPY", "166.200", "0.024"),
};

function seedQuote(symbol: SymbolName, mid: string, spread: string): Quote {
  const precision = decimalsForSymbol(symbol);
  const half = Number(spread) / 2;
  return {
    symbol,
    bid: (Number(mid) - half).toFixed(precision),
    ask: (Number(mid) + half).toFixed(precision),
    mid: Number(mid).toFixed(precision),
    spread: Number(spread).toFixed(precision),
    timestamp: "2026-06-09T12:00:00.000Z",
    source: "simulated",
    anchor_source: "ECB",
    anchor_date: "2026-06-09",
    anchor_stale: true,
  };
}

function decimalsForSymbol(symbol: string): number {
  return symbol.endsWith("/JPY") ? 3 : 5;
}

function formatPrice(symbol: string, value: string | number): string {
  return Number(value).toFixed(decimalsForSymbol(symbol));
}

function formatMoney(value: string | number | undefined): string {
  const parsed = Number(value ?? 0);
  return parsed.toLocaleString(undefined, {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

function formatQuantity(value: string | number): string {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toISOString().slice(11, 19);
}

function ageLabel(value: string, nowMs: number): string {
  if (!nowMs) {
    return "waiting";
  }

  const ageMs = nowMs - new Date(value).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "waiting";
  }
  if (ageMs < 1000) {
    return "now";
  }
  return `${Math.floor(ageMs / 1000)}s ago`;
}

function chartY(value: number, min: number, max: number): number {
  const range = max - min || 1;

  return ChartSize.Padding + (1 - (value - min) / range) * (ChartSize.Height - ChartSize.Padding * 2);
}

function candleX(index: number, total: number): number {
  const slotWidth = (ChartSize.Width - ChartSize.Padding * 2) / Math.max(total, 1);
  return ChartSize.Padding + slotWidth * index + slotWidth / 2;
}

function candleWidth(total: number): number {
  const slotWidth = (ChartSize.Width - ChartSize.Padding * 2) / Math.max(total, 1);
  return Math.max(7, Math.min(24, slotWidth * 0.58));
}

function statusLabel(status: FeedStatus): string {
  switch (status) {
    case "live":
      return "Live simulation";
    case "stale":
      return "Stale anchor";
    case "disconnected":
      return "Disconnected";
    default:
      return "Connecting";
  }
}

export default function ForexTerminal() {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolName>("EUR/USD");
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>("5min");
  const [prices, setPrices] = useState<Record<SymbolName, Quote>>(seededQuotes);
  const [series, setSeries] = useState<Record<SymbolName, PricePoint[]>>(() =>
    Object.fromEntries(SYMBOLS.map((symbol) => [symbol, []])) as Record<SymbolName, PricePoint[]>,
  );
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to simulated real-time feed.");
  const [quantity, setQuantity] = useState("1000");
  const [orderMessage, setOrderMessage] = useState("");
  const [historyMessage, setHistoryMessage] = useState("Loading ECB daily history.");
  const [account, setAccount] = useState<AccountSummary>({
    cashBalanceUsd: "100000.00000000",
    equityUsd: "100000.00000000",
    realizedPnlUsd: "0.00000000",
    unrealizedPnlUsd: "0.00000000",
  });
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const bootstrapTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(bootstrapTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      setStatus((current) => (current === "live" ? current : "connecting"));
      source = new EventSource(
        `/api/v1/forex/stream?symbols=${encodeURIComponent(SYMBOLS.join(","))}`,
      );

      source.addEventListener("snapshot", (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { data: Quote[] };
        mergeQuotes(payload.data);
        setStatus("live");
        setStatusMessage("Shared simulator feed connected.");
        attempt = 0;
      });

      source.addEventListener("tick", (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { data: Quote[] };
        mergeQuotes(payload.data);
        setStatus(payload.data.some((quote) => quote.anchor_stale) ? "stale" : "live");
        setStatusMessage("Simulated prices generated from ECB daily anchors.");
      });

      source.addEventListener("heartbeat", () => {
        setStatus((current) => (current === "disconnected" ? "connecting" : current));
      });

      source.addEventListener("error", () => {
        source?.close();
        setStatus("disconnected");
        setStatusMessage("Feed disconnected. Reconnecting with backoff.");
        const delay = Math.min(15000, 750 * 2 ** attempt) + Math.random() * 500;
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      source?.close();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory(): Promise<void> {
      try {
        const response = await fetch(
          `/api/v1/forex/history?symbols=${encodeURIComponent(SYMBOLS.join(","))}&days=45`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(`History API returned HTTP ${response.status}.`);
        }
        const payload = (await response.json()) as {
          data: HistoricalPayloadPoint[];
          failure?: string | null;
        };
        if (cancelled) {
          return;
        }

        const historyBySymbol = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, []])) as Record<SymbolName, PricePoint[]>;
        for (const point of payload.data) {
          const value = Number(point.mid);
          if (!Number.isFinite(value)) {
            continue;
          }
          historyBySymbol[point.symbol].push({
            source: "ecb",
            timestamp: point.timestamp,
            value,
          });
        }

        setSeries((currentSeries) => {
          const next = { ...currentSeries };
          for (const symbol of SYMBOLS) {
            const livePoints = (currentSeries[symbol] ?? []).filter((point) => point.source !== "ecb");
            next[symbol] = [...historyBySymbol[symbol], ...livePoints].slice(-MaxHistoryPoints);
          }
          return next;
        });
        setHistoryMessage(
          payload.failure
            ? `ECB daily history unavailable: ${payload.failure}`
            : "ECB daily history loaded for the last month.",
        );
      } catch (error) {
        if (!cancelled) {
          setHistoryMessage(error instanceof Error ? error.message : "ECB daily history unavailable.");
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  function mergeQuotes(quotes: Quote[]): void {
    setPrices((current) => {
      const next = { ...current };
      for (const quote of quotes) {
        const previous = current[quote.symbol];
        const previousMid = Number(previous?.mid ?? quote.mid);
        const mid = Number(quote.mid);
        next[quote.symbol] = quote;
        setTicks((currentTicks) => [
          {
            symbol: quote.symbol,
            time: quote.timestamp,
            side: mid >= previousMid ? "Up" : "Down",
            mid: quote.mid,
            spread: quote.spread,
          },
          ...currentTicks,
        ].slice(0, 10));
        setSeries((currentSeries) => ({
          ...currentSeries,
          [quote.symbol]: appendLivePricePoint(
            currentSeries[quote.symbol] ?? [],
            { timestamp: quote.timestamp, value: mid },
            MaxHistoryPoints,
          ),
        }));
      }
      return next;
    });
  }

  async function refreshAccount(): Promise<void> {
    try {
      const [accountResponse, positionsResponse, tradesResponse] = await Promise.all([
        fetch("/api/v1/account", { cache: "no-store" }),
        fetch("/api/v1/positions", { cache: "no-store" }),
        fetch("/api/v1/trades", { cache: "no-store" }),
      ]);
      if (accountResponse.ok) {
        setAccount((await accountResponse.json()) as AccountSummary);
      }
      if (positionsResponse.ok) {
        const payload = (await positionsResponse.json()) as { positions: Position[] };
        setPositions(payload.positions);
      }
      if (tradesResponse.ok) {
        const payload = (await tradesResponse.json()) as { trades: Trade[] };
        setTrades(payload.trades);
      }
    } catch {
      setOrderMessage("Account APIs unavailable. Check D1 migration and binding.");
    }
  }

  async function submitOrder(side: "buy" | "sell"): Promise<void> {
    setOrderMessage("Submitting simulated market order.");
    try {
      const response = await fetch("/api/v1/orders", {
        body: JSON.stringify({
          symbol: selectedSymbol,
          side,
          quantity,
          order_type: "market",
          client_order_id: crypto.randomUUID(),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      let payload: { execution_price?: string; message?: string } = {};
      try {
        payload = (await response.json()) as { execution_price?: string; message?: string };
      } catch {
        payload = {};
      }
      if (!response.ok || !payload.execution_price) {
        setOrderMessage(payload.message ?? "Order rejected by the simulator.");
        return;
      }
      setOrderMessage(
        `${side === "buy" ? "Bought" : "Sold"} ${formatQuantity(quantity)} ${selectedSymbol} at ${formatPrice(
          selectedSymbol,
          payload.execution_price,
        )}.`,
      );
      await refreshAccount();
    } catch {
      setOrderMessage("Order API unavailable. Try again after the simulator reconnects.");
    }
  }

  const activePrice = prices[selectedSymbol];
  const activeHistory = useMemo(
    () => series[selectedSymbol] ?? [],
    [selectedSymbol, series],
  );
  const activeLiveHistory = useMemo(
    () => activeHistory.filter((point) => point.source !== "ecb"),
    [activeHistory],
  );
  const activeChartHistory = useMemo(
    () => selectedInterval === "1d" || selectedInterval === "1w" ? activeHistory : activeLiveHistory,
    [activeHistory, activeLiveHistory, selectedInterval],
  );
  const previousMid = activeLiveHistory.length > 1 ? activeLiveHistory[activeLiveHistory.length - 2].value : Number(activePrice.mid);
  const priceChange = Number(activePrice.mid) - previousMid;
  const isUp = priceChange >= 0;
  const candles = useMemo(
    () => aggregateCandlesForInterval(activeChartHistory, selectedInterval, chartIntervalCandles[selectedInterval]),
    [activeChartHistory, selectedInterval],
  );
  const candleChartWidth = candleWidth(candles.length);
  const latestPricePoint = useMemo(
    () => ({
      timestamp: activePrice.timestamp,
      value: Number(activePrice.mid),
    }),
    [activePrice.mid, activePrice.timestamp],
  );
  const marketRange = useMemo(
    () => marketRangeForWindow(activeHistory, latestPricePoint, MarketStatsWindowMs),
    [activeHistory, latestPricePoint],
  );
  const candleLow = candles.length ? Math.min(...candles.map((candle) => candle.low)) : latestPricePoint.value;
  const candleHigh = candles.length ? Math.max(...candles.map((candle) => candle.high)) : latestPricePoint.value;
  const chartPadding = Math.max(latestPricePoint.value * 0.00002, (candleHigh - candleLow) * 0.08);
  const chartMin = candleLow - chartPadding;
  const chartMax = candleHigh + chartPadding;
  const resolvedStatus =
    status === "live" && now - new Date(activePrice.timestamp).getTime() > 12000 ? "stale" : status;
  const askLevels = Array.from({ length: 7 }, (_, index) => {
    const step = index + 1;
    const price = Number(activePrice.ask) + Number(activePrice.spread) * step * 0.62;
    return {
      price: formatPrice(selectedSymbol, price),
      size: formatQuantity(Number(quantity || 0) * (1.8 + step * 0.42)),
      total: formatQuantity(Number(quantity || 0) * (2.4 + step * 0.83)),
    };
  }).reverse();
  const bidLevels = Array.from({ length: 7 }, (_, index) => {
    const step = index + 1;
    const price = Number(activePrice.bid) - Number(activePrice.spread) * step * 0.62;
    return {
      price: formatPrice(selectedSymbol, price),
      size: formatQuantity(Number(quantity || 0) * (1.6 + step * 0.38)),
      total: formatQuantity(Number(quantity || 0) * (2.1 + step * 0.76)),
    };
  });
  const spreadBps = ((Number(activePrice.spread) / Number(activePrice.mid)) * 10000).toFixed(2);

  return (
    <main className="app-scroll terminal-shell text-[var(--ink)]">
      <div className="min-h-screen">
        <header className="exchange-header">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="brand-mark">FX</div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-extrabold">Aster Exchange</h1>
                <p className="truncate text-xs font-semibold text-[var(--muted)]">
                  ECB-anchored simulated forex terminal
                </p>
              </div>
            </div>
            <nav aria-label="Trading sections" className="top-nav">
              <span className="active">Markets</span>
              <span>Spot</span>
              <span>Derivatives</span>
              <span>Grid</span>
              <span>Portfolio</span>
              <span>Rewards</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`status-pill status-${resolvedStatus}`}>
                <span className="connection-dot" />
                {statusLabel(resolvedStatus)}
              </span>
              <span className="data-badge">Virtual USD account</span>
            </div>
          </div>

          <section aria-label="Market ticker" className="ticker-strip">
            {SYMBOLS.map((symbol) => {
              const price = prices[symbol];
              const liveSeriesForSymbol = (series[symbol] ?? []).filter((point) => point.source !== "ecb");
              const prior = liveSeriesForSymbol.length > 1 ? liveSeriesForSymbol[liveSeriesForSymbol.length - 2].value : Number(price.mid);
              const directionUp = Number(price.mid) >= prior;
              return (
                <button
                  className={`ticker-tile ${symbol === selectedSymbol ? "is-active" : ""}`}
                  key={symbol}
                  onClick={() => setSelectedSymbol(symbol)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-extrabold">{symbol}</span>
                    <span className={`mono text-xs font-bold ${directionUp ? "price-up" : "price-down"}`}>
                      {directionUp ? "+" : "-"}
                      {formatPrice(symbol, Math.abs(Number(price.mid) - prior))}
                    </span>
                  </div>
                  <div className={`mono mt-1 text-sm font-extrabold ${directionUp ? "price-up" : "price-down"}`}>
                    {formatPrice(symbol, price.mid)}
                  </div>
                </button>
              );
            })}
          </section>
        </header>

        <div className="mx-auto grid max-w-[1640px] gap-2 px-2 py-2">
          <section className="terminal-panel terminal-notice px-3 py-2 text-xs font-semibold">
            Simulated market data. Daily reference anchors use ECB statistics; generated ticks are not live or tradable market quotations. This product does not provide investment advice.
          </section>

          {resolvedStatus !== "live" && (
            <section className="terminal-panel px-3 py-2 text-xs font-semibold text-[var(--muted)]">
              {statusMessage}
            </section>
          )}

          <section className="terminal-panel px-3 py-2 text-xs font-semibold text-[var(--muted)]">
            {historyMessage}
          </section>

          <section className="grid items-start gap-2 xl:grid-cols-[278px_minmax(0,1fr)_356px]">
            <aside className="terminal-panel overflow-hidden">
              <div className="panel-heading">
                <h2>Markets</h2>
                <span>Bid / Ask</span>
              </div>
              <div className="tab-row">
                <span className="active">Favorites</span>
                <span>Majors</span>
                <span>Crosses</span>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {SYMBOLS.map((symbol) => {
                  const price = prices[symbol];
                  const liveSeriesForSymbol = (series[symbol] ?? []).filter((point) => point.source !== "ecb");
                  const prior = liveSeriesForSymbol.length > 1 ? liveSeriesForSymbol[liveSeriesForSymbol.length - 2].value : Number(price.mid);
                  const directionUp = Number(price.mid) >= prior;
                  return (
                    <button
                      className={`watch-row ${symbol === selectedSymbol ? "is-active" : ""}`}
                      key={symbol}
                      onClick={() => setSelectedSymbol(symbol)}
                      type="button"
                    >
                      <div>
                        <p className="text-sm font-extrabold">{symbol}</p>
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          {price.anchor_stale ? "stale anchor" : "ECB anchor"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`mono text-sm font-extrabold ${directionUp ? "price-up" : "price-down"}`}>
                          {formatPrice(symbol, price.bid)} / {formatPrice(symbol, price.ask)}
                        </p>
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          Spread {formatPrice(symbol, price.spread)} · {ageLabel(price.timestamp, now)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="grid gap-2">
              <div className="terminal-panel p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold text-[var(--muted)]">{selectedSymbol} perpetual simulator</p>
                    <div className="mt-1 flex flex-wrap items-end gap-3">
                      <h2 className={`mono text-4xl font-extrabold ${isUp ? "price-up" : "price-down"}`}>
                        {formatPrice(selectedSymbol, activePrice.mid)}
                      </h2>
                      <span className={`mb-2 mono text-sm font-extrabold ${isUp ? "price-up" : "price-down"}`}>
                        {isUp ? "+" : ""}
                        {formatPrice(selectedSymbol, priceChange)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right text-xs font-semibold text-[var(--muted)] sm:grid-cols-4">
                    <p>24h High <strong className="mono block text-[var(--ink)]">{formatPrice(selectedSymbol, marketRange.high)}</strong></p>
                    <p>24h Low <strong className="mono block text-[var(--ink)]">{formatPrice(selectedSymbol, marketRange.low)}</strong></p>
                    <p>Spread <strong className="mono block text-[var(--ink)]">{spreadBps} bps</strong></p>
                    <p>Tick <strong className="mono block text-[var(--ink)]">{timeLabel(activePrice.timestamp)}</strong></p>
                  </div>
                </div>
                <div className="interval-row mt-3" aria-label="Chart time intervals">
                  <span>Time</span>
                  {CHART_INTERVALS.map((interval) => (
                    <button
                      aria-pressed={selectedInterval === interval}
                      className={selectedInterval === interval ? "is-active" : ""}
                      key={interval}
                      onClick={() => setSelectedInterval(interval)}
                      type="button"
                    >
                      {interval}
                    </button>
                  ))}
                </div>
                <div className="chart-shell mt-2">
                  <div className="chart-grid" />
                  <svg
                    aria-label={`${selectedSymbol} simulated OHLC candle chart`}
                    className="chart-candles"
                    role="img"
                    viewBox={`0 0 ${ChartSize.Width} ${ChartSize.Height}`}
                  >
                    {candles.map((candle, index) => {
                      const x = candleX(index, candles.length);
                      const openY = chartY(candle.open, chartMin, chartMax);
                      const closeY = chartY(candle.close, chartMin, chartMax);
                      const highY = chartY(candle.high, chartMin, chartMax);
                      const lowY = chartY(candle.low, chartMin, chartMax);
                      const bodyHeight = Math.max(3, Math.abs(closeY - openY));
                      const bodyY = Math.min(openY, closeY) - (bodyHeight === 3 ? 1.5 : 0);
                      const volumeHeight = Math.max(
                        10,
                        Math.min(42, (candle.volume / Math.max(chartMax - chartMin, 1)) * 220),
                      );
                      const directionClass = candle.close >= candle.open ? "candle-up" : "candle-down";
                      return (
                        <g className={directionClass} key={`${candle.bucket}-${index}`}>
                          <rect
                            className="candle-volume"
                            height={volumeHeight.toFixed(1)}
                            rx="2"
                            width={candleChartWidth.toFixed(1)}
                            x={(x - candleChartWidth / 2).toFixed(1)}
                            y={(ChartSize.Height - ChartSize.Padding - volumeHeight).toFixed(1)}
                          />
                          <line
                            className="candle-wick"
                            x1={x.toFixed(1)}
                            x2={x.toFixed(1)}
                            y1={highY.toFixed(1)}
                            y2={lowY.toFixed(1)}
                          />
                          <rect
                            className="candle-body"
                            height={bodyHeight.toFixed(1)}
                            rx="2"
                            width={candleChartWidth.toFixed(1)}
                            x={(x - candleChartWidth / 2).toFixed(1)}
                            y={bodyY.toFixed(1)}
                          />
                        </g>
                      );
                    })}
                  </svg>
                  <div className="chart-label left-4 top-5">{formatPrice(selectedSymbol, chartMax)}</div>
                  <div className="chart-label bottom-5 right-4">{formatPrice(selectedSymbol, chartMin)}</div>
                </div>
              </div>

              <div className="grid gap-2 2xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="terminal-panel overflow-hidden">
                  <div className="panel-heading">
                    <h2>Open positions</h2>
                    <span>Simulator P/L</span>
                  </div>
                  <div className="responsive-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Market</th>
                          <th>Side</th>
                          <th>Units</th>
                          <th>Avg</th>
                          <th>Unrealized P/L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.length ? (
                          positions.map((position) => (
                            <tr key={position.symbol}>
                              <td>{position.symbol}</td>
                              <td className={position.side === "short" ? "text-[var(--red)]" : "text-[var(--green)]"}>
                                {position.side}
                              </td>
                              <td>{formatQuantity(position.quantity)}</td>
                              <td>{formatPrice(position.symbol, position.averageEntryPrice)}</td>
                              <td className={Number(position.unrealizedPnlUsd) < 0 ? "text-[var(--red)]" : "text-[var(--green)]"}>
                                {formatMoney(position.unrealizedPnlUsd)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5}>No open simulated positions.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="terminal-panel p-3">
                  <div className="panel-heading no-pad">
                    <h2>Assets</h2>
                    <span>USD margin</span>
                  </div>
                  <p className="mono mt-4 text-3xl font-extrabold">{formatMoney(account.equityUsd)}</p>
                  <p className="mt-1 text-xs font-semibold text-[var(--muted)]">Equity includes unrealized simulator P/L.</p>
                  <div className="mt-4 grid gap-3">
                    <div className="metric-row">
                      <span>Cash</span>
                      <strong>{formatMoney(account.cashBalanceUsd)}</strong>
                    </div>
                    <div className="metric-row">
                      <span>Realized P/L</span>
                      <strong>{formatMoney(account.realizedPnlUsd)}</strong>
                    </div>
                    <div className="metric-row">
                      <span>Unrealized P/L</span>
                      <strong>{formatMoney(account.unrealizedPnlUsd)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <aside className="grid content-start gap-2">
              <div className="terminal-panel overflow-hidden">
                <div className="panel-heading">
                  <h2>Order book</h2>
                  <span>{selectedSymbol}</span>
                </div>
                <div className="depth-header">
                  <span>Price</span>
                  <span>Size</span>
                  <span>Total</span>
                </div>
                <div className="book-table">
                  {askLevels.map((level) => (
                    <div className="book-row ask" key={`ask-${level.price}`}>
                      <span>{level.price}</span>
                      <span>{level.size}</span>
                      <span>{level.total}</span>
                    </div>
                  ))}
                  <div className="spread-row">
                    <strong className={`mono ${isUp ? "price-up" : "price-down"}`}>{formatPrice(selectedSymbol, activePrice.mid)}</strong>
                    <span>Spread {formatPrice(selectedSymbol, activePrice.spread)} / {spreadBps} bps</span>
                  </div>
                  {bidLevels.map((level) => (
                    <div className="book-row bid" key={`bid-${level.price}`}>
                      <span>{level.price}</span>
                      <span>{level.size}</span>
                      <span>{level.total}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="panel-heading no-pad">
                  <h2>Spot order</h2>
                  <span>Market</span>
                </div>
                <label className="field-label mt-4" htmlFor="symbol">
                  Pair
                </label>
                <select
                  className="field"
                  id="symbol"
                  onChange={(event) => setSelectedSymbol(event.target.value as SymbolName)}
                  value={selectedSymbol}
                >
                  {SYMBOLS.map((symbol) => (
                    <option key={symbol}>{symbol}</option>
                  ))}
                </select>
                <label className="field-label" htmlFor="size">
                  Quantity
                </label>
                <input
                  className="field"
                  id="size"
                  inputMode="decimal"
                  onChange={(event) => setQuantity(event.target.value)}
                  value={quantity}
                />
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="quote-tile">
                    <span>Sell at bid</span>
                    <strong className="price-down">{formatPrice(selectedSymbol, activePrice.bid)}</strong>
                  </div>
                  <div className="quote-tile">
                    <span>Buy at ask</span>
                    <strong className="price-up">{formatPrice(selectedSymbol, activePrice.ask)}</strong>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button className="order-button sell" onClick={() => void submitOrder("sell")} type="button">
                    Sell
                  </button>
                  <button className="order-button buy" onClick={() => void submitOrder("buy")} type="button">
                    Buy
                  </button>
                </div>
                {orderMessage && <p className="mt-3 text-xs font-semibold text-[var(--muted)]">{orderMessage}</p>}
              </div>

              <div className="terminal-panel overflow-hidden">
                <div className="panel-heading">
                  <h2>Trade history</h2>
                  <span>{trades.length ? "Latest fills" : "No fills"}</span>
                </div>
                <div className="divide-y divide-[var(--line)]">
                  {(trades.length ? trades : []).map((trade) => (
                    <div className="trade-row" key={trade.id}>
                      <span>{timeLabel(trade.executed_at)}</span>
                      <span className={trade.side === "sell" ? "text-[var(--red)]" : "text-[var(--green)]"}>
                        {trade.side}
                      </span>
                      <span>{trade.symbol}</span>
                      <span>{formatPrice(trade.symbol, trade.execution_price)}</span>
                    </div>
                  ))}
                  {!trades.length && <div className="trade-row"><span>Waiting for simulated fills</span></div>}
                </div>
              </div>

              <div className="terminal-panel overflow-hidden">
                <div className="panel-heading">
                  <h2>Recent ticks</h2>
                  <span>Shared feed</span>
                </div>
                <div className="divide-y divide-[var(--line)]">
                  {(ticks.length ? ticks : [{ symbol: selectedSymbol, time: activePrice.timestamp, side: "Up" as const, mid: activePrice.mid, spread: activePrice.spread }]).map((tick, index) => (
                    <div className="trade-row" key={`${tick.time}-${tick.symbol}-${index}`}>
                      <span>{timeLabel(tick.time)}</span>
                      <span className={tick.side === "Down" ? "text-[var(--red)]" : "text-[var(--green)]"}>
                        {tick.side}
                      </span>
                      <span>{tick.symbol}</span>
                      <span>{formatPrice(tick.symbol, tick.mid)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        </div>
        <div className="mobile-actions">
          <button className="order-button sell" onClick={() => void submitOrder("sell")} type="button">
            Sell {selectedSymbol}
          </button>
          <button className="order-button buy" onClick={() => void submitOrder("buy")} type="button">
            Buy {selectedSymbol}
          </button>
        </div>
      </div>
    </main>
  );
}
