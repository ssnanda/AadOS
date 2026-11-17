import { messageBus, type BusEvent } from '$lib/server/message-bus';

// Server-Sent Events: the Messages page listens here and gets each BlueBubbles event the moment the webhook fires.
export const GET = async () => {
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: BusEvent) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { cleanup(); } };
      const beat = setInterval(() => { try { controller.enqueue(enc.encode(': ping\n\n')); } catch { cleanup(); } }, 25_000);
      messageBus().on('event', send);
      cleanup = () => { clearInterval(beat); messageBus().off('event', send); };
      controller.enqueue(enc.encode(': connected\n\n'));
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
};
