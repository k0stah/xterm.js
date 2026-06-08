import {
  jsonError,
  maybeRefreshAnchors,
  parseSymbolsFromRequest,
  publicQuote,
} from "@/lib/forex/http";
import { getMarketEngine } from "@/lib/forex/singleton";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  try {
    await maybeRefreshAnchors();
    const symbols = parseSymbolsFromRequest(request);
    const quotes = getMarketEngine()
      .snapshot()
      .filter((quote) => symbols.includes(quote.symbol))
      .map(publicQuote);
    return Response.json({ type: "snapshot", data: quotes });
  } catch (error) {
    return jsonError(error);
  }
}
