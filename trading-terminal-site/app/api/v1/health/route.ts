import { getMarketEngine } from "@/lib/forex/singleton";
import { getD1 } from "@/lib/forex/http";
import { ensureSchema } from "@/lib/forex/repository";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function GET() {
  const checks = {
    http: "ok",
    database: "unknown",
    redis: "not_configured",
    simulationWorker: "local_module_singleton",
    anchorData: getMarketEngine().anchors().length ? "available" : "unavailable",
  };
  try {
    const db = getD1();
    await ensureSchema(db);
    await db.prepare("SELECT COUNT(*) AS count FROM trading_accounts").first();
    checks.database = "ok";
  } catch {
    checks.database = "unavailable";
  }
  return Response.json({
    status: checks.database === "ok" && checks.anchorData === "available" ? "ok" : "degraded",
    checks,
    note:
      "Redis and a dedicated simulation worker are production scaling requirements; this local Sites MVP uses a module singleton.",
  });
}
