import {
  jsonError,
  maybeRefreshAnchors,
  parseSymbolsFromRequest,
  publicQuote,
} from "@/lib/forex/http";
import { getMarketEngine } from "@/lib/forex/singleton";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const encoder = new TextEncoder();

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  eventName: string,
  payload: unknown,
): void {
  controller.enqueue(
    encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`),
  );
}

export async function GET(request: Request) {
  try {
    await maybeRefreshAnchors();
    const symbols = parseSymbolsFromRequest(request);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let tickCount = 0;
        let heartbeatCount = 0;
        const engine = getMarketEngine();
        writeEvent(controller, "snapshot", {
          type: "snapshot",
          data: engine
            .snapshot()
            .filter((quote) => symbols.includes(quote.symbol))
            .map(publicQuote),
        });

        const interval = setInterval(() => {
          if (request.signal.aborted) {
            clearInterval(interval);
            controller.close();
            return;
          }
          tickCount += 1;
          heartbeatCount += 1;
          const quotes = engine
            .tick()
            .filter((quote) => symbols.includes(quote.symbol))
            .map(publicQuote);
          writeEvent(controller, "tick", { type: "tick", data: quotes });
          if (heartbeatCount >= 15) {
            heartbeatCount = 0;
            writeEvent(controller, "heartbeat", {
              type: "heartbeat",
              timestamp: new Date().toISOString(),
            });
          }
          if (tickCount % 60 === 0) {
            console.info("forex.generated_ticks", {
              tickCount,
              subscriptions: symbols,
            });
          }
        }, Number(process.env.FOREX_TICK_INTERVAL_MS ?? 1000));

        request.signal.addEventListener(
          "abort",
          () => {
            clearInterval(interval);
            controller.close();
          },
          { once: true },
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
