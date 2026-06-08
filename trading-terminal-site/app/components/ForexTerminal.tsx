"use client";

import { useEffect, useMemo, useState } from "react";

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

function ageLabel(value: string): string {
  const ageMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "waiting";
  }
  if (ageMs < 1000) {
    return "now";
  }
  return `${Math.floor(ageMs / 1000)}s ago`;
}

function chartPoints(values: number[]): string {
  const width = 760;
  const height = 250;
  const padding = 16;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2);
      const y = padding + (1 - (value - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function createSeedSeries(start: number): number[] {
  return Array.from({ length: 28 }, (_, index) => {
    const drift = Math.sin(index / 3) * start * 0.00025;
    const pulse = Math.cos(index / 5) * start * 0.00012;
    return start + drift + pulse;
  });
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
  const [prices, setPrices] = useState<Record<SymbolName, Quote>>(seededQuotes);
  const [series, setSeries] = useState<Record<SymbolName, number[]>>(() =>
    Object.fromEntries(
      SYMBOLS.map((symbol) => [symbol, createSeedSeries(Number(seededQuotes[symbol].mid))]),
    ) as Record<SymbolName, number[]>,
  );
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to simulated real-time feed.");
  const [quantity, setQuantity] = useState("1000");
  const [orderMessage, setOrderMessage] = useState("");
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
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
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
          [quote.symbol]: [...(currentSeries[quote.symbol] ?? []), mid].slice(-48),
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
    const payload = await response.json();
    if (!response.ok) {
      setOrderMessage(payload.message ?? "Order rejected.");
      return;
    }
    setOrderMessage(
      `${side === "buy" ? "Bought" : "Sold"} ${formatQuantity(quantity)} ${selectedSymbol} at ${formatPrice(
        selectedSymbol,
        payload.execution_price,
      )}.`,
    );
    await refreshAccount();
  }

  const activePrice = prices[selectedSymbol];
  const activeSeries = useMemo(
    () => series[selectedSymbol] ?? [],
    [selectedSymbol, series],
  );
  const previousMid = activeSeries.length > 1 ? activeSeries[activeSeries.length - 2] : Number(activePrice.mid);
  const priceChange = Number(activePrice.mid) - previousMid;
  const isUp = priceChange >= 0;
  const chartPath = useMemo(() => chartPoints(activeSeries), [activeSeries]);
  const chartMin = Math.min(...activeSeries);
  const chartMax = Math.max(...activeSeries);
  const resolvedStatus =
    status === "live" && now - new Date(activePrice.timestamp).getTime() > 12000 ? "stale" : status;

  return (
    <main className="app-scroll bg-[var(--page)] text-[var(--ink)]">
      <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-[1480px] gap-4">
          <header className="terminal-panel flex flex-wrap items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--amber)] text-base font-semibold text-[var(--ink)]">
                FX
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">Aster Forex Simulator</h1>
                <p className="truncate text-sm text-[var(--muted)]">
                  Simulated real-time feed / virtual USD account
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`status-pill status-${resolvedStatus}`}>
                <span className="connection-dot" />
                {statusLabel(resolvedStatus)}
              </span>
              <span className="data-badge">Source of daily reference rates: ECB statistics.</span>
            </div>
          </header>

          <section className="terminal-panel px-4 py-3 text-sm text-[var(--muted)]">
            Simulated market data. Daily reference-rate anchors are based on ECB statistics. Prices shown between daily anchors are generated by the simulator and are not live or tradable market quotations. This product does not provide investment advice.
          </section>

          {resolvedStatus !== "live" && (
            <section className="terminal-panel px-4 py-3 text-sm text-[var(--muted)]">
              {statusMessage}
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
            <aside className="terminal-panel overflow-hidden">
              <div className="panel-heading">
                <h2>Market watch</h2>
                <span>Bid / ask</span>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {SYMBOLS.map((symbol) => {
                  const price = prices[symbol];
                  const seriesForSymbol = series[symbol] ?? [];
                  const prior = seriesForSymbol.length > 1 ? seriesForSymbol[seriesForSymbol.length - 2] : Number(price.mid);
                  const directionUp = Number(price.mid) >= prior;
                  return (
                    <button
                      className={`watch-row ${symbol === selectedSymbol ? "is-active" : ""}`}
                      key={symbol}
                      onClick={() => setSelectedSymbol(symbol)}
                      type="button"
                    >
                      <div>
                        <p className="font-semibold">{symbol}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {directionUp ? "Up" : "Down"} · {price.anchor_stale ? "stale anchor" : "ECB anchor"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">
                          {formatPrice(symbol, price.bid)} / {formatPrice(symbol, price.ask)}
                        </p>
                        <p className="text-sm text-[var(--muted)]">
                          Spread {formatPrice(symbol, price.spread)} · {ageLabel(price.timestamp)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="grid gap-4">
              <div className="terminal-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-[var(--muted)]">{selectedSymbol} · Live simulation</p>
                    <div className="mt-1 flex flex-wrap items-end gap-3">
                      <h2 className="text-3xl font-semibold">
                        {formatPrice(selectedSymbol, activePrice.mid)}
                      </h2>
                      <span className={`mb-1 text-sm font-medium ${isUp ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                        {isUp ? "+" : ""}
                        {formatPrice(selectedSymbol, priceChange)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-sm text-[var(--muted)]">
                    <p>Anchor date {activePrice.anchor_date}</p>
                    <p>{activePrice.anchor_source} reference anchor, generated tick {timeLabel(activePrice.timestamp)}</p>
                  </div>
                </div>
                <div className="chart-shell mt-5">
                  <div className="chart-grid" />
                  <svg
                    aria-label={`${selectedSymbol} simulated mid-price chart`}
                    className="chart-candles"
                    role="img"
                    viewBox="0 0 760 250"
                  >
                    <polyline className="tick-line-shadow" points={chartPath} />
                    <polyline className="tick-line" points={chartPath} />
                    {activeSeries.map((value, index) => {
                      if (index % 6 !== 0 && index !== activeSeries.length - 1) {
                        return null;
                      }
                      const point = chartPoints(activeSeries.slice(0, index + 1)).split(" ").at(-1);
                      const [x = "0", y = "0"] = point?.split(",") ?? [];
                      return <circle className="tick-dot" cx={x} cy={y} key={`${value}-${index}`} r={index === activeSeries.length - 1 ? 5 : 3} />;
                    })}
                  </svg>
                  <div className="chart-label left-4 top-5">{formatPrice(selectedSymbol, chartMax)}</div>
                  <div className="chart-label bottom-5 right-4">{formatPrice(selectedSymbol, chartMin)}</div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="terminal-panel overflow-hidden">
                  <div className="panel-heading">
                    <h2>Open positions</h2>
                    <span>Executable spread marks</span>
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

                <div className="terminal-panel p-4">
                  <div className="panel-heading no-pad">
                    <h2>Account</h2>
                    <span>USD cash</span>
                  </div>
                  <p className="mt-5 text-3xl font-semibold">{formatMoney(account.equityUsd)}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Equity includes unrealized simulator P/L.</p>
                  <div className="mt-5 grid gap-3">
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

            <aside className="grid gap-4">
              <div className="terminal-panel p-4">
                <div className="panel-heading no-pad">
                  <h2>Trading panel</h2>
                  <span>Market orders</span>
                </div>
                <label className="field-label mt-5" htmlFor="symbol">
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
                    <strong>{formatPrice(selectedSymbol, activePrice.bid)}</strong>
                  </div>
                  <div className="quote-tile">
                    <span>Buy at ask</span>
                    <strong>{formatPrice(selectedSymbol, activePrice.ask)}</strong>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button className="rounded-lg bg-[var(--red)] px-4 py-3 font-semibold text-white" onClick={() => void submitOrder("sell")} type="button">
                    Sell
                  </button>
                  <button className="rounded-lg bg-[var(--green)] px-4 py-3 font-semibold text-white" onClick={() => void submitOrder("buy")} type="button">
                    Buy
                  </button>
                </div>
                {orderMessage && <p className="mt-3 text-sm text-[var(--muted)]">{orderMessage}</p>}
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
      </div>
    </main>
  );
}
