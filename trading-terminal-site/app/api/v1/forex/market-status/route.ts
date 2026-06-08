import { getAnchorState, getMarketEngine } from "@/lib/forex/singleton";
import { maybeRefreshAnchors } from "@/lib/forex/http";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  await maybeRefreshAnchors();
  return Response.json({
    ...getMarketEngine().status(),
    anchorSourceAttribution: "Source of daily reference rates: ECB statistics.",
    lastAnchorRefreshFailure: getAnchorState().lastFailure,
  });
}
