import { getUserId, jsonError } from "@/lib/forex/http";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const userId = getUserId(request);
    const expiresIn = 30;
    const ticket = crypto.randomUUID();
    console.info("forex.ws_ticket_issued", {
      userHash: await digestUser(userId),
      expiresIn,
    });
    return Response.json({
      ticket,
      expires_in: expiresIn,
      note:
        "Ticket issuance is exposed for the intended WebSocket contract. The current Sites MVP streams prices through /api/v1/forex/stream over SSE.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function digestUser(userId: string): Promise<string> {
  const data = new TextEncoder().encode(userId);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
