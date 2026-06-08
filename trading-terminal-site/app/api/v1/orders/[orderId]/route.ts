import { getD1, getUserId, jsonError, responseError } from "@/lib/forex/http";
import { getOrder } from "@/lib/forex/repository";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await context.params;
    const order = await getOrder(getD1(), getUserId(request), orderId);
    if (!order) {
      throw responseError("ORDER_NOT_FOUND", "Order was not found.", 404);
    }
    return Response.json(order);
  } catch (error) {
    return jsonError(error);
  }
}
