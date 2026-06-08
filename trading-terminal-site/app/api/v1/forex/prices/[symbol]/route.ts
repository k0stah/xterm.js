import {
  jsonError,
  maybeRefreshAnchors,
  publicQuote,
  responseError,
} from "@/lib/forex/http";
import {
  isSupportedSymbol,
  normalizeSymbol,
} from "@/lib/forex/market";
import { getMarketEngine } from "@/lib/forex/singleton";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  try {
    await maybeRefreshAnchors();
    const { symbol: rawSymbol } = await context.params;
    const symbol = normalizeSymbol(rawSymbol);
    if (!isSupportedSymbol(symbol)) {
      throw responseError(
        "UNSUPPORTED_SYMBOL",
        "The requested symbol is not supported.",
        400,
        { symbol },
      );
    }
    return Response.json({ type: "snapshot", data: publicQuote(getMarketEngine().quote(symbol)) });
  } catch (error) {
    return jsonError(error);
  }
}
