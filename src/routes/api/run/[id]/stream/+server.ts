import { bus } from '$lib/server/events';
import type { RunEvent } from '$lib/server/events';

export async function GET({ params }) {
  const runId = params.id;
  const encoder = new TextEncoder();

  let hb: ReturnType<typeof setInterval>;
  let unsub: (() => void) | undefined;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    unsub?.();
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // stream already closed/cancelled — stop emitting and release resources
          cleanup();
        }
      };

      hb = setInterval(() => send({ phase: 'heartbeat' }), 15000);
      unsub = bus.subscribe(runId, (e) => {
        send(e);
        if (e.phase === 'done' || e.phase === 'error') {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });
    },
    // Browser disconnect (refresh / navigate away) before done/error lands here —
    // without this the heartbeat interval leaks and enqueues onto a dead stream.
    cancel() {
      cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
}
