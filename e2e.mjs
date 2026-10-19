// Headless-Chrome end-to-end test: serves this folder, drives every slider and
// preset, and checks the DOM readouts equal the shared model (model.js).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import * as M from "./model.js";
import { execFileSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".ttf": "font/ttf" };
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

// ---- fonts: every rendered (family, weight, style) has a real @font-face covering it (no faux bold/italic),
// the face loaded, and the face file's cmap contains every character rendered in it.
{
  const fp = await browser.newPage(); await fp.setViewport({ width: 1600, height: 1000 });
  await fp.goto(BASE + "/", { waitUntil: "networkidle0" }); await fp.evaluate(() => document.fonts.ready);
  const r = await fp.evaluate(() => {
    const used = {}; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) { const e = n.parentElement; if (!e || !n.textContent.trim() || e.closest("script,style")) continue;
      const cs = getComputedStyle(e); const fam = (e.getAttribute("font-family") || cs.fontFamily).split(",")[0].replace(/["']/g, "").trim();
      const k = `${fam}|${cs.fontWeight}|${cs.fontStyle}`; used[k] = (used[k] || "") + n.textContent; }
    const faces = [...document.fonts].map(f => ({ family: f.family.replace(/["']/g, ""), style: f.style, weight: f.weight, status: f.status }));
    const srcs = [...document.styleSheets].flatMap(ss => [...ss.cssRules]).filter(r => r instanceof CSSFontFaceRule).map(r => ({ family: r.style.getPropertyValue("font-family").replace(/["']/g, "").trim(), style: r.style.getPropertyValue("font-style"), src: (r.style.getPropertyValue("src").match(/url\("?([^")]+)"?\)/) || [])[1] }));
    return { used: Object.fromEntries(Object.entries(used).map(([k, v]) => [k, [...new Set(v)].join("")])), faces, srcs };
  });
  const KNOWN_FALLBACK = new Set(["∈"]); // not in EB Garamond / Inter / Playfair; renders from the system fallback font
  const glyphReq = {};
  for (const [k, chars] of Object.entries(r.used)) {
    const [fam, w, st] = k.split("|"); const wt = +w;
    const face = r.faces.find(f => f.family === fam && f.style === st && (() => { const [a, b = a] = f.weight.split(" ").map(Number); return wt >= a && wt <= b; })());
    console.log(`font: ${fam} ${wt} ${st} -> face ${face ? face.weight + ' ' + face.status : 'NONE'}`);
    assert(!!face && face.status === "loaded", `real face for ${fam} ${wt} ${st} (${face ? face.weight + " " + face.status : "NONE -> synthesized"})`);
    const src = r.srcs.find(x => x.family === fam && x.style === st)?.src;
    if (src) (glyphReq[src] ||= { fam, chars: "" }).chars += chars;
  }
  const py = "import json,sys\nfrom fontTools.ttLib import TTFont\nreq=json.loads(sys.argv[1]);print(json.dumps({f:[c for c in set(v['chars']) if c.strip() and ord(c) not in TTFont(sys.argv[2]+'/'+f).getBestCmap()] for f,v in req.items()}))";
  const miss = JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(glyphReq), root]).toString());
  for (const [f, m] of Object.entries(miss)) { console.log(`glyphs: ${f} missing ${m.join('') || 'none'}`); const bad = m.filter(c => !KNOWN_FALLBACK.has(c)); assert(bad.length === 0, `${f} covers every char rendered in ${glyphReq[f].fam}${m.length ? " (system fallback: " + m.join("") + ")" : ""}${bad.length ? " MISSING " + bad.join("") : ""}`); }
  const pf = r.used["Playfair Display|700|normal"]; assert(!!pf && r.faces.some(f => f.family === "Playfair Display" && f.weight === "400 900"), "h1 Playfair Display 700 served by variable 400–900 face (no faux bold)");
  await fp.close();
}
await browser.close(); server.close();
console.log(`\nE2E: ${passed} assertions passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
console.log("PASS: headless Chrome drove all 4 sliders + keyboard + 4 presets; readouts match model.js");
