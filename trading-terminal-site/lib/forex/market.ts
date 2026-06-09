import {
  absDecimal,
  addDecimal,
  compareDecimal,
  decimalToNumber,
  divideDecimal,
  isPositiveDecimal,
  multiplyDecimal,
  subtractDecimal,
  toDecimal,
  type DecimalString,
} from "./decimal.js";

export const SUPPORTED_SYMBOLS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "EUR/GBP",
  "EUR/JPY",
] as const;

export type ForexSymbol = (typeof SUPPORTED_SYMBOLS)[number];
export type AnchorCurrency = "USD" | "GBP" | "JPY" | "CHF";

export type AnchorRate = {
  currency: AnchorCurrency;
  rate: DecimalString;
  observationDate: string;
  retrievedAt: string;
  source: "ECB";
};

export type DerivedInstrument = {
  symbol: ForexSymbol;
  base: string;
  quote: string;
  anchorMid: DecimalString;
  precision: number;
  quoteConvention: string;
};

export type Quote = {
  symbol: ForexSymbol;
  bid: DecimalString;
  ask: DecimalString;
  mid: DecimalString;
  spread: DecimalString;
  timestamp: string;
  source: "simulated";
  anchorSource: "ECB";
  anchorDate: string;
  anchorStale: boolean;
};

export type HistoricalPricePoint = {
  symbol: ForexSymbol;
  timestamp: string;
  mid: DecimalString;
  source: "ECB";
  anchorDate: string;
};

export type MarketStatus = {
  simulatorStatus: "running" | "degraded";
  latestTickTimestamp: string | null;
  ecbAnchorObservationDate: string | null;
  ecbRetrievalTimestamp: string | null;
  anchorAgeSeconds: number | null;
  anchorStale: boolean;
  simulationSeedIdentifier: string | null;
};

export const FALLBACK_ANCHORS: AnchorRate[] = [
  {
    currency: "USD",
    rate: "1.15400000",
    observationDate: "2026-06-09",
    retrievedAt: "2026-06-09T00:00:00.000Z",
    source: "ECB",
  },
  {
    currency: "GBP",
    rate: "0.84200000",
    observationDate: "2026-06-09",
    retrievedAt: "2026-06-09T00:00:00.000Z",
    source: "ECB",
  },
  {
    currency: "JPY",
    rate: "166.20000000",
    observationDate: "2026-06-09",
    retrievedAt: "2026-06-09T00:00:00.000Z",
    source: "ECB",
  },
  {
    currency: "CHF",
    rate: "0.93600000",
    observationDate: "2026-06-09",
    retrievedAt: "2026-06-09T00:00:00.000Z",
    source: "ECB",
  },
];

const REQUIRED_CURRENCIES: AnchorCurrency[] = ["USD", "GBP", "JPY", "CHF"];

const INSTRUMENT_PRECISION: Record<ForexSymbol, number> = {
  "EUR/USD": 5,
  "GBP/USD": 5,
  "USD/JPY": 3,
  "USD/CHF": 5,
  "EUR/GBP": 5,
  "EUR/JPY": 3,
};

export function isSupportedSymbol(value: string): value is ForexSymbol {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(value);
}

export function normalizeSymbol(value: string): string {
  return decodeURIComponent(value).trim().toUpperCase().replace("_", "/");
}

export function precisionForSymbol(symbol: ForexSymbol): number {
  return INSTRUMENT_PRECISION[symbol];
}

export function parseEcbCsv(csv: string, retrievedAt = new Date().toISOString()): AnchorRate[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("ECB response did not contain data rows.");
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.toUpperCase());
  const currencyIndex = headers.indexOf("CURRENCY");
  const valueIndex = headers.indexOf("OBS_VALUE");
  const dateIndex = headers.indexOf("TIME_PERIOD");
  if (currencyIndex < 0 || valueIndex < 0 || dateIndex < 0) {
    throw new Error("ECB response is missing CURRENCY, TIME_PERIOD, or OBS_VALUE columns.");
  }

  const rates = new Map<AnchorCurrency, AnchorRate>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const currency = cells[currencyIndex]?.toUpperCase() as AnchorCurrency | undefined;
    const rawRate = cells[valueIndex];
    const observationDate = cells[dateIndex];
    if (!currency || !REQUIRED_CURRENCIES.includes(currency)) {
      continue;
    }
    if (!rawRate || !observationDate) {
      continue;
    }
    const rate = toDecimal(rawRate, 8);
    if (!isPositiveDecimal(rate)) {
      continue;
    }
    rates.set(currency, {
      currency,
      rate,
      observationDate,
      retrievedAt,
      source: "ECB",
    });
  }

  const parsed = REQUIRED_CURRENCIES.map((currency) => rates.get(currency));
  if (parsed.some((rate) => !rate)) {
    throw new Error("ECB response did not include all required USD, GBP, JPY, and CHF anchors.");
  }
  return parsed as AnchorRate[];
}

export function parseEcbHistoricalCsv(csv: string, retrievedAt = new Date().toISOString()): AnchorRate[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("ECB historical response did not contain data rows.");
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.toUpperCase());
  const currencyIndex = headers.indexOf("CURRENCY");
  const valueIndex = headers.indexOf("OBS_VALUE");
  const dateIndex = headers.indexOf("TIME_PERIOD");
  if (currencyIndex < 0 || valueIndex < 0 || dateIndex < 0) {
    throw new Error("ECB historical response is missing CURRENCY, TIME_PERIOD, or OBS_VALUE columns.");
  }

  const rates: AnchorRate[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const currency = cells[currencyIndex]?.toUpperCase() as AnchorCurrency | undefined;
    const rawRate = cells[valueIndex];
    const observationDate = cells[dateIndex];
    if (!currency || !REQUIRED_CURRENCIES.includes(currency) || !rawRate || !observationDate) {
      continue;
    }

    try {
      const rate = toDecimal(rawRate, 8);
      if (!isPositiveDecimal(rate)) {
        continue;
      }
      rates.push({
        currency,
        observationDate,
        rate,
        retrievedAt,
        source: "ECB",
      });
    } catch {
      continue;
    }
  }

  return rates;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function deriveInstruments(anchors: AnchorRate[]): DerivedInstrument[] {
  const byCurrency = Object.fromEntries(
    anchors.map((anchor) => [anchor.currency, anchor.rate]),
  ) as Record<AnchorCurrency, DecimalString>;

  for (const currency of REQUIRED_CURRENCIES) {
    if (!byCurrency[currency]) {
      throw new Error(`Missing ECB anchor for ${currency}.`);
    }
  }

  const eurUsd = byCurrency.USD;
  const eurGbp = byCurrency.GBP;
  const eurJpy = byCurrency.JPY;
  const eurChf = byCurrency.CHF;

  const definitions: Array<[ForexSymbol, DecimalString, string]> = [
    ["EUR/USD", eurUsd, "USD per EUR; direct ECB USD-per-EUR reference rate."],
    ["EUR/GBP", eurGbp, "GBP per EUR; direct ECB GBP-per-EUR reference rate."],
    ["EUR/JPY", eurJpy, "JPY per EUR; direct ECB JPY-per-EUR reference rate."],
    ["GBP/USD", divideDecimal(eurUsd, eurGbp, 8), "USD per GBP = EUR/USD divided by EUR/GBP."],
    ["USD/JPY", divideDecimal(eurJpy, eurUsd, 8), "JPY per USD = EUR/JPY divided by EUR/USD."],
    ["USD/CHF", divideDecimal(eurChf, eurUsd, 8), "CHF per USD = EUR/CHF divided by EUR/USD."],
  ];

  return definitions.map(([symbol, anchorMid, quoteConvention]) => {
    const [base, quote] = symbol.split("/");
    return {
      symbol,
      base,
      quote,
      anchorMid: toDecimal(anchorMid, 8),
      precision: precisionForSymbol(symbol),
      quoteConvention,
    };
  });
}

export function deriveHistoricalPricePoints(anchors: AnchorRate[]): HistoricalPricePoint[] {
  const byDate = new Map<string, AnchorRate[]>();
  for (const anchor of anchors) {
    const dailyAnchors = byDate.get(anchor.observationDate) ?? [];
    dailyAnchors.push(anchor);
    byDate.set(anchor.observationDate, dailyAnchors);
  }

  const points: HistoricalPricePoint[] = [];
  for (const [observationDate, dailyAnchors] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const currencies = new Set(dailyAnchors.map((anchor) => anchor.currency));
    if (REQUIRED_CURRENCIES.some((currency) => !currencies.has(currency))) {
      continue;
    }

    for (const instrument of deriveInstruments(dailyAnchors)) {
      points.push({
        anchorDate: observationDate,
        mid: instrument.anchorMid,
        source: "ECB",
        symbol: instrument.symbol,
        timestamp: `${observationDate}T00:00:00.000Z`,
      });
    }
  }

  return points;
}

export function convertQuoteAmountToUsd(
  quoteCurrency: string,
  amount: DecimalString,
  prices: Partial<Record<ForexSymbol, Quote>>,
): DecimalString {
  if (quoteCurrency === "USD") {
    return toDecimal(amount, 8);
  }
  if (quoteCurrency === "JPY") {
    const usdJpy = prices["USD/JPY"];
    if (!usdJpy) {
      throw new Error("USD/JPY price is required for JPY to USD conversion.");
    }
    return divideDecimal(amount, usdJpy.mid, 8);
  }
  if (quoteCurrency === "CHF") {
    const usdChf = prices["USD/CHF"];
    if (!usdChf) {
      throw new Error("USD/CHF price is required for CHF to USD conversion.");
    }
    return divideDecimal(amount, usdChf.mid, 8);
  }
  if (quoteCurrency === "GBP") {
    const gbpUsd = prices["GBP/USD"];
    if (!gbpUsd) {
      throw new Error("GBP/USD price is required for GBP to USD conversion.");
    }
    return multiplyDecimal(amount, gbpUsd.mid, 8);
  }
  throw new Error(`Unsupported quote currency ${quoteCurrency}.`);
}

export function calculateUnrealizedPnlUsd(
  symbol: ForexSymbol,
  quantity: DecimalString,
  averageEntryPrice: DecimalString,
  prices: Partial<Record<ForexSymbol, Quote>>,
): DecimalString {
  const quote = prices[symbol];
  if (!quote) {
    return "0.00000000";
  }
  const quoteCurrency = symbol.split("/")[1];
  const markPrice = compareDecimal(quantity, "0") >= 0 ? quote.bid : quote.ask;
  const rawPnl = multiplyDecimal(
    subtractDecimal(markPrice, averageEntryPrice, 8),
    quantity,
    8,
  );
  return convertQuoteAmountToUsd(quoteCurrency, rawPnl, prices);
}

export function calculateOrderCashDeltaUsd(
  symbol: ForexSymbol,
  side: "buy" | "sell",
  quantity: DecimalString,
  executionPrice: DecimalString,
  prices: Partial<Record<ForexSymbol, Quote>>,
): DecimalString {
  const quoteCurrency = symbol.split("/")[1];
  const quoteAmount = multiplyDecimal(quantity, executionPrice, 8);
  const usdAmount = convertQuoteAmountToUsd(quoteCurrency, quoteAmount, prices);
  return side === "buy" ? `-${usdAmount}` : usdAmount;
}

export function calculateRealizedPnlUsd(
  symbol: ForexSymbol,
  closingQuantityAbs: DecimalString,
  previousQuantity: DecimalString,
  averageEntryPrice: DecimalString,
  executionPrice: DecimalString,
  prices: Partial<Record<ForexSymbol, Quote>>,
): DecimalString {
  const quoteCurrency = symbol.split("/")[1];
  const quotePnl =
    compareDecimal(previousQuantity, "0") > 0
      ? multiplyDecimal(subtractDecimal(executionPrice, averageEntryPrice, 8), closingQuantityAbs, 8)
      : multiplyDecimal(subtractDecimal(averageEntryPrice, executionPrice, 8), closingQuantityAbs, 8);
  return convertQuoteAmountToUsd(quoteCurrency, quotePnl, prices);
}

export function nextAverageEntryPrice(
  previousQuantity: DecimalString,
  previousAverage: DecimalString,
  signedOrderQuantity: DecimalString,
  executionPrice: DecimalString,
): { quantity: DecimalString; averageEntryPrice: DecimalString; closedQuantityAbs: DecimalString } {
  const nextQuantity = addDecimal(previousQuantity, signedOrderQuantity, 8);
  const sameDirection =
    compareDecimal(previousQuantity, "0") === 0 ||
    (compareDecimal(previousQuantity, "0") > 0 && compareDecimal(signedOrderQuantity, "0") > 0) ||
    (compareDecimal(previousQuantity, "0") < 0 && compareDecimal(signedOrderQuantity, "0") < 0);

  if (sameDirection) {
    const weightedExisting = multiplyDecimal(absDecimal(previousQuantity, 8), previousAverage, 8);
    const weightedNew = multiplyDecimal(absDecimal(signedOrderQuantity, 8), executionPrice, 8);
    const totalAbs = addDecimal(absDecimal(previousQuantity, 8), absDecimal(signedOrderQuantity, 8), 8);
    return {
      quantity: nextQuantity,
      averageEntryPrice: divideDecimal(addDecimal(weightedExisting, weightedNew, 8), totalAbs, 8),
      closedQuantityAbs: "0.00000000",
    };
  }

  const closedQuantityAbs =
    compareDecimal(absDecimal(signedOrderQuantity, 8), absDecimal(previousQuantity, 8)) <= 0
      ? absDecimal(signedOrderQuantity, 8)
      : absDecimal(previousQuantity, 8);

  if (compareDecimal(nextQuantity, "0") === 0) {
    return {
      quantity: "0.00000000",
      averageEntryPrice: "0.00000000",
      closedQuantityAbs,
    };
  }

  const reversed =
    (compareDecimal(previousQuantity, "0") > 0 && compareDecimal(nextQuantity, "0") < 0) ||
    (compareDecimal(previousQuantity, "0") < 0 && compareDecimal(nextQuantity, "0") > 0);

  return {
    quantity: nextQuantity,
    averageEntryPrice: reversed ? executionPrice : previousAverage,
    closedQuantityAbs,
  };
}

export function quoteToNumber(quote: Quote): number {
  return decimalToNumber(quote.mid);
}
