import {
  getD1,
  getUserId,
  jsonError,
  pricesBySymbol,
} from "@/lib/forex/http";
import { getAccountSummary } from "@/lib/forex/repository";
import { calculateUnrealizedPnlUsd } from "@/lib/forex/market";
import { positionSide } from "@/lib/forex/portfolio";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const prices = pricesBySymbol();
    const summary = await getAccountSummary(getD1(), getUserId(request), prices);
    return Response.json({
      positions: summary.positions.map((position) => ({
        ...position,
        side: positionSide(position.quantity),
        unrealizedPnlUsd: calculateUnrealizedPnlUsd(
          position.symbol,
          position.quantity,
          position.averageEntryPrice,
          prices,
        ),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
