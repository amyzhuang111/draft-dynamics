// Headless-Chrome end-to-end test: serves this folder, drives every slider and
// preset, and checks the DOM readouts equal the shared model (model.js).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import * as M from "./model.js";

const root = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  try { const p = join(root, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    const body = await readFile(p); res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const BASE = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const host = new URL(BASE).origin;
console.log(`E2E target: ${BASE}`);

let passed = 0; const failures = [];
const assert = (c, m) => { if (c) passed++; else { failures.push(m); console.error("FAIL:", m); } };
const expected = u => {
  const xs = M.trajectory(u), s = M.fixedPoint(u);
  return { dist: M.fmtDist(M.distance(u)), x40: `x₄₀ = [${xs[M.STEPS].map(v => M.fmt(v, 3)).join(", ")}]`, xs: `x* = [${s.map(v => M.fmt(v, 3)).join(", ")}]`, uline: `[${u.map(v => M.fmt(v)).join(", ")}]` };
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
const page = await browser.newPage();
const errors = [], failedReq = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(String(e)));
page.on("requestfailed", r => failedReq.push(r.url()));
page.on("response", r => { if (r.status() >= 400) failedReq.push(`${r.status()} ${r.url()}`); });
page.on("request", r => { if (!r.url().startsWith(host) && !r.url().startsWith("data:")) failedReq.push("external:" + r.url()); });
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);

const read = () => page.evaluate(() => ({ dist: document.getElementById("dist").textContent, xread: document.getElementById("xread").innerText, eig: document.getElementById("eig").textContent, o: [0,1,2,3].map(i => document.getElementById("o" + i).textContent), traces: document.querySelectorAll("#traces .trace").length, circles: document.querySelectorAll("#portrait circle").length }));
const check = async (u, label) => {
  const r = await read(), e = expected(u);
  assert(r.dist === e.dist, `${label}: dist ${r.dist} == model ${e.dist}`);
  assert(r.xread.includes(e.x40), `${label}: ${e.x40}`);
  assert(r.xread.includes(e.xs), `${label}: ${e.xs}`);
  assert(r.xread.includes(e.uline), `${label}: u readout ${e.uline}`);
  assert(r.o.join(",") === u.map(v => M.fmt(v)).join(","), `${label}: slider outputs ${r.o}`);
  assert(r.traces === 4 && r.circles >= 41, `${label}: 4 traces + 41 orbit points rendered`);
  return r;
};

const r0 = await check([...M.DEFAULT_U], "default");
assert(r0.dist === "0.000365", `default dist is 0.000365 (got ${r0.dist})`);
assert(r0.eig === M.eigString() && r0.eig.includes("ρ(A)=0.834"), `eigen line = model, rho 0.834`);
const fams = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family));
["Playfair Display", "EB Garamond", "Inter", "JetBrains Mono"].forEach(f => assert(fams.includes(f), `font loaded locally: ${f}`));

let u = [...M.DEFAULT_U];
for (let i = 0; i < 4; i++) for (const v of [0, 0.73, 1]) {
  await page.$eval(`#s${i}`, (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  u[i] = v;
  const r = await check([...u], `slider ${M.MOVES[i]}=${v}`);
}
// keyboard drive on slider 0 (real user input path)
await page.focus("#s0"); await page.keyboard.press("ArrowLeft"); u[0] = Math.round((u[0] - 0.01) * 100) / 100;
await check([...u], "slider Research ArrowLeft");
for (const [name, val] of Object.entries(M.PRESETS)) {
  const [btn] = await page.$$(`xpath/.//button[normalize-space()="${name}"]`);
  await btn.click();
  const r = await check([...val], `preset ${name}`);
  const active = await page.$$eval("#presets button.active", b => b.map(x => x.textContent));
  assert(active.length === 1 && active[0] === name, `preset ${name} marked active`);
  const sv = await page.$$eval("input[type=range]", s => s.map(x => +x.value));
  assert(sv.join() === val.join(), `preset ${name}: sliders synced ${sv}`);
}
// 390px: matrices must not wrap and must not overflow the page
await page.setViewport({ width: 390, height: 900 });
const m = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, rows: [...document.querySelectorAll("#matA,#matB")].map(el => { const lh = parseFloat(getComputedStyle(el).lineHeight); return Math.round(el.scrollHeight / lh); }), lines: [...document.querySelectorAll("#matA,#matB")].map(el => el.textContent.split("\n").length) }));
const clipped = await page.evaluate(() => [...document.querySelectorAll(".matrix")].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.id || "equations"));
console.log(`390px horizontally scrollable blocks: ${clipped.join(",") || "none"}`);
assert(!clipped.includes("equations"), "390px: equations text wraps, not clipped");
assert(!clipped.includes("matA") && !clipped.includes("matB"), "390px: A/B matrices fit without horizontal scrolling");
console.log(`390px matrix font-size: ${await page.$eval("#matA", el => getComputedStyle(el).fontSize)}`);
assert(m.docW <= 390, `390px: no page-level horizontal overflow (scrollWidth ${m.docW})`);
m.rows.forEach((r, k) => assert(r <= m.lines[k] + 1, `390px: matrix ${k} rows rendered ${r} <= text lines ${m.lines[k]} (no wrap)`));

assert(errors.length === 0, `no console/page errors (${errors.join(" | ")})`);
assert(failedReq.length === 0, `no failed or external requests (${failedReq.join(" | ")})`);
await browser.close(); server.close();
console.log(`\nE2E: ${passed} assertions passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
console.log("PASS: headless Chrome drove all 4 sliders + keyboard + 4 presets; readouts match model.js");
