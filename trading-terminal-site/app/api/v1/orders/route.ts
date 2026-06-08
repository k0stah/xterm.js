import {
  getD1,
  getUserId,
  jsonError,
  pricesBySymbol,
} from "@/lib/forex/http";
import {
  createMarketOrder,
  listOrders,
} from "@/lib/forex/repository";

export const dynamic = "force-dynamic";
export const runtime = "edge";

function allowShortSelling(): boolean {
  return (process.env.FOREX_ALLOW_SHORT_SELLING ?? "false").toLowerCase() === "true";
}

export async function GET(request: Request) {
  try {
    return Response.json({ orders: await listOrders(getD1(), getUserId(request)) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const order = await createMarketOrder(
      getD1(),
      getUserId(request),
      (await request.json()) as Record<string, string>,
      pricesBySymbol(),
      allowShortSelling(),
    );
    console.info("forex.order_filled", {
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
    });
    return Response.json(order, { status: 201 });
  } catch (error) {
    console.info("forex.order_rejected", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonError(error);
  }
}
