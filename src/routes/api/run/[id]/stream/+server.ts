import { bus } from '$lib/server/events';
import type { RunEvent } from '$lib/server/events';

export async function GET({ params }) {
  const runId = params.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: RunEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      const hb = setInterval(() => send({ phase: 'heartbeat' }), 15000);
      const unsub = bus.subscribe(runId, (e) => {
        send(e);
        if (e.phase === 'done' || e.phase === 'error') {
          clearInterval(hb);
          unsub();
          controller.close();
        }
      });
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
