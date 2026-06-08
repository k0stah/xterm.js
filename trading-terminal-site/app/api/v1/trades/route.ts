import { getD1, getUserId, jsonError } from "@/lib/forex/http";
import { listTrades } from "@/lib/forex/repository";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(request: Request) {
  try {
    return Response.json({ trades: await listTrades(getD1(), getUserId(request)) });
  } catch (error) {
    return jsonError(error);
  }
}
