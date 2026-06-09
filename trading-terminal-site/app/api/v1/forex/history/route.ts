import {
  jsonError,
  parseSymbolsFromRequest,
} from "@/lib/forex/http";
import { getHistoricalPrices, getHistoryState } from "@/lib/forex/singleton";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? 45);
    const symbols = parseSymbolsFromRequest(request);
    const data = (await getHistoricalPrices(days))
      .filter((point) => symbols.includes(point.symbol))
      .map((point) => ({
        symbol: point.symbol,
        timestamp: point.timestamp,
        mid: point.mid,
        source: point.source,
        anchor_date: point.anchorDate,
      }));
    const historyState = getHistoryState();
    return Response.json({
      type: "history",
      data,
      days: historyState.days,
      retrieved_at: historyState.retrievedAt,
      source: "ECB",
      failure: historyState.lastFailure,
    });
  } catch (error) {
    return jsonError(error);
  }
}
