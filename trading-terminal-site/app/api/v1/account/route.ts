import {
  getD1,
  getUserId,
  jsonError,
  pricesBySymbol,
} from "@/lib/forex/http";
import { getAccountSummary } from "@/lib/forex/repository";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const summary = await getAccountSummary(getD1(), getUserId(request), pricesBySymbol());
    return Response.json(summary);
  } catch (error) {
    return jsonError(error);
  }
}
