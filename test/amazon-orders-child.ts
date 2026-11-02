// A server's process, with no simulated page: reads a page that names a server of its own at every turn, and prints what
// happened. test/amazon-orders.test.ts runs it, since Bun.serve takes no Response from the simulated page the tests share.
import { parse, readOrderDetails, readOrders } from '../server/amazon-orders';

const asked: string[] = [];
const thrown: string[] = [];
process.on('unhandledRejection', (reason) => thrown.push(String(reason)));
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    asked.push(new URL(request.url).pathname);
    return new Response('globalThis.amazonOrdersPageRan = true', { headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } });
  },
});
const here = `http://127.0.0.1:${server.port}`;
const page = `<html><head><link rel="stylesheet" href="${here}/stylesheet"><link rel="modulepreload" href="${here}/module"><link rel="preload" as="fetch" href="${here}/preload"><link rel="preload" as="fetch" href="/relative-preload"><meta http-equiv="refresh" content="0;url=${here}/refresh"></head>
  <body onload="globalThis.amazonOrdersPageRan = true"><img src="${here}/image"><iframe src="${here}/frame"></iframe><iframe srcdoc="<link rel=preload as=fetch href=${here}/frame-preload><link rel=preload as=fetch href=/frame-relative>"></iframe><object data="${here}/object"></object><embed src="${here}/embed">
  <svg><script href="${here}/svg-script"></script></svg><script src="${here}/script-with-no-end">`;
const orders = readOrders(page);
const details = readOrderDetails(page);
// What happy-dom acts on is what is attached to a document.
const elements = [...parse(page).querySelectorAll('*')];
// Anything the page set off would reach this server before the answer to a request sent after it.
await fetch(`${here}/after`);
console.log(
  JSON.stringify({
    page: typeof document,
    orders,
    details,
    elements: elements.length,
    attached: elements.filter((element) => element.isConnected).length,
    asked,
    thrown,
    ran: 'amazonOrdersPageRan' in globalThis,
  }),
);
await server.stop(true);
