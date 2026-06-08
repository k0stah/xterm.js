import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveInstruments,
  parseEcbCsv,
} from "../.tmp-test/market.js";
import { MarketSimulationEngine } from "../.tmp-test/simulation.js";
import {
  executeMarketOrder,
  summarizeAccount,
} from "../.tmp-test/portfolio.js";

const csv = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-06-09,1.154
EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-06-09,0.842
EXR.D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,2026-06-09,166.2
EXR.D.CHF.EUR.SP00.A,D,CHF,EUR,SP00,A,2026-06-09,0.936
`;

function pricesFromEngine() {
  const engine = new MarketSimulationEngine(parseEcbCsv(csv, "2026-06-09T14:30:00.000Z"), {
    seed: "test-seed",
    meanReversion: 0.01,
  });
  return Object.fromEntries(engine.tick(new Date("2026-06-09T14:30:00.000Z")).map((quote) => [quote.symbol, quote]));
}

test("parses ECB CSV anchors without modifying source values", () => {
  const anchors = parseEcbCsv(csv, "2026-06-09T14:30:00.000Z");
  assert.equal(anchors.length, 4);
  assert.deepEqual(
    anchors.map((anchor) => [anchor.currency, anchor.rate, anchor.observationDate, anchor.source]),
    [
      ["USD", "1.15400000", "2026-06-09", "ECB"],
      ["GBP", "0.84200000", "2026-06-09", "ECB"],
      ["JPY", "166.20000000", "2026-06-09", "ECB"],
      ["CHF", "0.93600000", "2026-06-09", "ECB"],
    ],
  );
});

test("rejects malformed or incomplete ECB responses", () => {
  assert.throws(() => parseEcbCsv("not,enough\n"), /missing|data/i);
  assert.throws(() => parseEcbCsv("CURRENCY,TIME_PERIOD,OBS_VALUE\nUSD,2026-06-09,1.1\n"), /required/i);
});

test("derives direct and cross rates using explicit quote conventions", () => {
  const derived = Object.fromEntries(
    deriveInstruments(parseEcbCsv(csv)).map((instrument) => [instrument.symbol, instrument]),
  );
  assert.equal(derived["EUR/USD"].anchorMid, "1.15400000");
  assert.equal(derived["EUR/GBP"].anchorMid, "0.84200000");
  assert.equal(derived["EUR/JPY"].anchorMid, "166.20000000");
  assert.equal(derived["GBP/USD"].anchorMid, "1.37054631");
  assert.equal(derived["USD/JPY"].anchorMid, "144.02079722");
  assert.equal(derived["USD/CHF"].anchorMid, "0.81109185");
});

test("simulation is deterministic for a fixed seed and preserves bid/mid/ask invariants", () => {
  const anchors = parseEcbCsv(csv);
  const first = new MarketSimulationEngine(anchors, { seed: "fixed" });
  const second = new MarketSimulationEngine(anchors, { seed: "fixed" });
  const firstTick = first.tick(new Date("2026-06-09T14:30:00.000Z"));
  const secondTick = second.tick(new Date("2026-06-09T14:30:00.000Z"));
  assert.deepEqual(firstTick, secondTick);
  for (const quote of firstTick) {
    assert.equal(quote.source, "simulated");
    assert.ok(Number(quote.bid) > 0);
    assert.ok(Number(quote.bid) < Number(quote.mid));
    assert.ok(Number(quote.mid) < Number(quote.ask));
    assert.ok(Number(quote.spread) > 0);
  }
});

test("buy orders execute at ask and reduce cash", () => {
  const prices = pricesFromEngine();
  const account = {
    cashBalanceUsd: "100000.00000000",
    realizedPnlUsd: "0.00000000",
    positions: [],
  };
  const result = executeMarketOrder(account, "EUR/USD", "buy", "1000", prices, false);
  assert.equal(result.executionPrice, prices["EUR/USD"].ask);
  assert.equal(result.position.quantity, "1000.00000000");
  assert.ok(Number(result.cashBalanceUsd) < 100000);
});

test("sell orders execute at bid and short selling can be disabled", () => {
  const prices = pricesFromEngine();
  const account = {
    cashBalanceUsd: "100000.00000000",
    realizedPnlUsd: "0.00000000",
    positions: [],
  };
  assert.throws(
    () => executeMarketOrder(account, "EUR/USD", "sell", "1000", prices, false),
    /Short selling/,
  );
  const result = executeMarketOrder(account, "EUR/USD", "sell", "1000", prices, true);
  assert.equal(result.executionPrice, prices["EUR/USD"].bid);
  assert.equal(result.position.quantity, "-1000.00000000");
});

test("rejects insufficient funds", () => {
  const prices = pricesFromEngine();
  const account = {
    cashBalanceUsd: "10.00000000",
    realizedPnlUsd: "0.00000000",
    positions: [],
  };
  assert.throws(
    () => executeMarketOrder(account, "EUR/USD", "buy", "100000", prices, false),
    /Insufficient/,
  );
});

test("handles position increase, reduction, close, reversal, and PnL", () => {
  const prices = pricesFromEngine();
  const account = {
    cashBalanceUsd: "100000.00000000",
    realizedPnlUsd: "0.00000000",
    positions: [],
  };
  const opened = executeMarketOrder(account, "EUR/USD", "buy", "1000", prices, true);
  const increased = executeMarketOrder(
    {
      cashBalanceUsd: opened.cashBalanceUsd,
      realizedPnlUsd: opened.realizedPnlUsd,
      positions: [opened.position],
    },
    "EUR/USD",
    "buy",
    "1000",
    prices,
    true,
  );
  assert.equal(increased.position.quantity, "2000.00000000");
  const reduced = executeMarketOrder(
    {
      cashBalanceUsd: increased.cashBalanceUsd,
      realizedPnlUsd: increased.realizedPnlUsd,
      positions: [increased.position],
    },
    "EUR/USD",
    "sell",
    "500",
    prices,
    true,
  );
  assert.equal(reduced.position.quantity, "1500.00000000");
  assert.notEqual(reduced.realizedPnlUsd, "0.00000000");
  const reversed = executeMarketOrder(
    {
      cashBalanceUsd: reduced.cashBalanceUsd,
      realizedPnlUsd: reduced.realizedPnlUsd,
      positions: [reduced.position],
    },
    "EUR/USD",
    "sell",
    "3000",
    prices,
    true,
  );
  assert.equal(reversed.position.quantity, "-1500.00000000");
  assert.equal(reversed.position.averageEntryPrice, prices["EUR/USD"].bid);
});

test("summarizes unrealized PnL using executable spread side", () => {
  const prices = pricesFromEngine();
  const opened = executeMarketOrder(
    {
      cashBalanceUsd: "100000.00000000",
      realizedPnlUsd: "0.00000000",
      positions: [],
    },
    "EUR/USD",
    "buy",
    "1000",
    prices,
    true,
  );
  const summary = summarizeAccount(
    {
      cashBalanceUsd: opened.cashBalanceUsd,
      realizedPnlUsd: opened.realizedPnlUsd,
      positions: [opened.position],
    },
    prices,
  );
  assert.ok(Number(summary.equityUsd) < 100000);
  assert.ok(Number(summary.unrealizedPnlUsd) <= 0);
});
