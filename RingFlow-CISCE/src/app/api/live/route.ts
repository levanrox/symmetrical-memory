import { eventMatchesScope, subscribeToLiveEvents, type LiveEvent } from "@/lib/realtime/bus";

/**
 * Server-Sent Events feed of database changes.
 *
 * Screens open one EventSource, scoped to what they show (a ring, a category, a
 * tournament, a single access request), and refetch through their existing
 * server actions when something lands. Polling stays in place as a slow safety
 * net, so a dropped stream degrades instead of freezing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = {
    ringId: url.searchParams.get("ringId"),
    tournamentId: url.searchParams.get("tournamentId"),
    categoryId: url.searchParams.get("categoryId"),
    requestId: url.searchParams.get("requestId"),
  };

  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client vanished between the check and the write.
          closed = true;
        }
      };

      // Tell the browser immediately that the pipe is open.
      write(`retry: 3000\n\n`);
      write(`event: ready\ndata: {}\n\n`);

      const unsubscribe = subscribeToLiveEvents((event: LiveEvent) => {
        if (closed || request.signal.aborted) return;
        if (!eventMatchesScope(event, scope)) return;
        write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        if (closed || request.signal.aborted) return;
        // A comment keeps proxies and the browser from timing the stream out.
        write(`: ping\n\n`);
      }, HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          if (!request.signal.aborted) {
            controller.close();
          }
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", () => {
        cleanup?.();
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
