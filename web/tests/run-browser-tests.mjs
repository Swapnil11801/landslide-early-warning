// Opens web/tests.html in headless Chrome and fails unless every parity check passes.
// Usage: serve web/ (e.g. `python -m http.server 8000 -d web`), then
//   node web/tests/run-browser-tests.mjs http://localhost:8000/tests.html [path/to/chrome]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:8000/tests.html";
const chromePath = process.argv[3] ?? process.env.CHROME ?? "google-chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "parity-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quit = (code, msg) => { console.log(msg); chrome.kill(); process.exit(code); };
setTimeout(() => quit(2, "timed out after 180 s"), 180000);

let ws;
for (let i = 0; i < 100 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* Chrome still starting */ }
  if (!ws) await sleep(200);
}
if (!ws) quit(1, "could not connect to Chrome");
if (ws.readyState !== 1) await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const j = JSON.parse(m.data);
  if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

await send("Page.navigate", { url });
for (let i = 0; i < 300; i++) {
  await sleep(500);
  const title = await evaluate("document.title");
  if (title === "PASS" || title === "FAIL") {
    console.log(await evaluate("document.querySelector('#summary').innerText"));
    if (title === "FAIL") console.log(await evaluate("[...document.querySelectorAll('tr')].filter(r => r.querySelector('.bad')).map(r => r.innerText).join('\n')"));
    quit(title === "PASS" ? 0 : 1, title);
  }
}
quit(2, "page never finished");
