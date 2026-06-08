import { deriveInstruments, FALLBACK_ANCHORS } from "@/lib/forex/market";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export function GET() {
  return Response.json({
    instruments: deriveInstruments(FALLBACK_ANCHORS).map((instrument) => ({
      symbol: instrument.symbol,
      base: instrument.base,
      quote: instrument.quote,
      precision: instrument.precision,
      quote_convention: instrument.quoteConvention,
    })),
    disclaimer:
      "Simulated market data. Daily reference-rate anchors are based on ECB statistics.",
  });
}
