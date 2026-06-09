export const CHART_INTERVALS = ["1min", "5min", "10min", "30min", "1h", "6h", "1d", "1w"] as const;

export type ChartInterval = (typeof CHART_INTERVALS)[number];

export type PricePoint = {
  source?: "ecb" | "live";
  synthetic?: boolean;
  timestamp: string;
  value: number;
};

export type Candle = {
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketRange = {
  high: number;
  low: number;
};

const chartIntervalMs: Record<ChartInterval, number> = {
  "1min": 60 * 1000,
  "5min": 5 * 60 * 1000,
  "10min": 10 * 60 * 1000,
  "30min": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

export function intervalMs(interval: ChartInterval): number {
  return chartIntervalMs[interval];
}

export function appendLivePricePoint(
  points: PricePoint[],
  point: PricePoint,
  maxPoints: number,
): PricePoint[] {
  return [
    ...points.filter((existingPoint) => !existingPoint.synthetic),
    {
      source: "live" as const,
      timestamp: point.timestamp,
      value: point.value,
    },
  ].slice(-maxPoints);
}

export function aggregateCandlesForInterval(
  points: PricePoint[],
  interval: ChartInterval,
  limit: number,
): Candle[] {
  const candles: Candle[] = [];

  for (const point of [...points].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || !Number.isFinite(point.value)) {
      continue;
    }

    const bucket = Math.floor(time / chartIntervalMs[interval]);
    const latest = candles[candles.length - 1];
    if (!latest || latest.bucket !== bucket) {
      candles.push({
        bucket,
        close: point.value,
        high: point.value,
        low: point.value,
        open: point.value,
        volume: 0,
      });
      continue;
    }

    latest.volume += Math.abs(point.value - latest.close);
    latest.close = point.value;
    latest.high = Math.max(latest.high, point.value);
    latest.low = Math.min(latest.low, point.value);
  }

  return candles.slice(-limit).map((candle) => ({
    ...candle,
    volume: Math.max(
      candle.volume,
      candle.high - candle.low,
      Math.abs(candle.close - candle.open),
      candle.open * 0.000005,
    ),
  }));
}

export function marketRangeForWindow(
  points: PricePoint[],
  currentPoint: PricePoint,
  windowMs: number,
): MarketRange {
  const currentTime = Date.parse(currentPoint.timestamp);
  const highLow = {
    high: currentPoint.value,
    low: currentPoint.value,
  };

  if (!Number.isFinite(currentTime) || !Number.isFinite(currentPoint.value)) {
    return highLow;
  }

  const startTime = currentTime - windowMs;
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || !Number.isFinite(point.value) || time < startTime || time > currentTime) {
      continue;
    }

    highLow.high = Math.max(highLow.high, point.value);
    highLow.low = Math.min(highLow.low, point.value);
  }

  return highLow;
}
