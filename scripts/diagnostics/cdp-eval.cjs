// Minimal CDP evaluator. Usage: node cdp-eval.cjs [--port 9333] <file.js | -e "expr">
// Evaluates an async-capable expression in the renderer and prints the returned value (JSON string).
const path = require('path');
const fs = require('fs');
const WebSocket = require(path.resolve(__dirname, '../../node_modules/ws'));
async function connect(port = 9333) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const pend = {};
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } });
  const send = (method, params = {}) => new Promise((r) => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  return { ws, send, ev, close: () => ws.close() };
}
module.exports = { connect };
if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2); let port = 9333;
    if (a[0] === '--port') { port = +a[1]; a.splice(0, 2); }
    const src = a[0] === '-e' ? a[1] : fs.readFileSync(a[0], 'utf8');
    const c = await connect(port);
    try { console.log(await c.ev(src)); } catch (e) { console.error('EVAL_ERROR', e.message); process.exitCode = 1; }
    c.close();
  })();
}
