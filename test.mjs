// Draft Dynamics — in-repo test harness. No dependencies (Node >= 18).
// Imports the page's own model (model.js, the same module index.html imports;
// no duplicate copy), runs the 41-step trajectory for the default u and all
// 4 presets, and checks:
//   1. every state stays in [0,1]^4
//   2. fixed-point convergence for default u: ||x40 - x*||2 < 0.01
//   3. rho(A) < 1, via this file's own Jacobi eigensolver + power iteration
//   4. the page's displayed eigenvalue string (produced by the page's own
//      eigenvaluesSym + fmt, extracted from index.html) matches this file's
//      independently computed eigenvalues within tolerance
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

let passed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; } else { failures.push(msg); console.error("FAIL:", msg); }
}
function section(name) { console.log(`\n== ${name}`); }

// ---------- The page's own model (single shared module, no copy) ----------
import * as M from "./model.js";
const { A, B, X0, STEPS, PRESETS, DEFAULT_U: defaultU, trajectory, fixedPoint, eigenvaluesSym, matVec } = M;
assert(/import \{[^}]*\} from '\.\/model\.js'/.test(html), "index.html imports its model from ./model.js");
assert(!/const A\s*=\s*\[\[/.test(html) && !/function trajectory/.test(html), "index.html contains no duplicate copy of the model");

section("shared model");
console.log(`A=${JSON.stringify(A)}`);
console.log(`B=${JSON.stringify(B)}`);
console.log(`x0=${JSON.stringify(X0)} default u=${JSON.stringify(defaultU)} STEPS=${STEPS}`);
console.log(`presets=${Object.keys(PRESETS).join(" | ")}`);
assert(A.length === 4 && A.every(r => r.length === 4), "A is 4x4");
assert(B.length === 4 && B.every(r => r.length === 4), "B is 4x4");
assert(X0.length === 4 && defaultU.length === 4, "x0 and default u are 4-vectors");
assert(STEPS === 40, "STEPS is 40 (41 states)");
assert(Object.keys(PRESETS).length === 4, "exactly 4 presets");

// ---------- Independent oracle for eigenvalues (different algorithms from the page's) ----------
// Own eigenvalue computation #1: classic cyclic Jacobi rotations.
function jacobiEigenvalues(M) {
  const n = M.length, a = M.map(r => [...r]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    }
  }
  return a.map((r, i) => r[i]).sort((x, y) => y - x);
}
// Own eigenvalue computation #2: power iteration for spectral radius.
function powerIterationRho(M) {
  let v = [1, 0.5, 0.25, 0.125];
  for (let it = 0; it < 10000; it++) {
    const w = matVec(M, v), norm = Math.hypot(...w);
    v = w.map(x => x / norm);
    const Av = matVec(M, v);
    const lambda = v.reduce((s, x, i) => s + x * Av[i], 0);
    const resid = Math.hypot(...Av.map((x, i) => x - lambda * v[i]));
    if (resid < 1e-12) return Math.abs(lambda);
  }
  throw new Error("power iteration did not converge");
}

// ---------- 1+2. Trajectories: bounds + fixed-point convergence ----------
section("trajectories (default u + 4 presets)");
const cases = [["default", defaultU], ...Object.entries(PRESETS)];
for (const [name, u] of cases) {
  const xs = trajectory(u);
  assert(xs.length === 41, `${name}: trajectory has 41 states (got ${xs.length})`);
  let inBox = 0;
  for (const x of xs) for (const v of x) if (v >= 0 && v <= 1) inBox++;
  assert(inBox === 41 * 4, `${name}: all ${inBox}/164 coordinates within [0,1]^4`);
  const xStar = fixedPoint(u);
  const dist = Math.hypot(...xs[STEPS].map((v, i) => v - xStar[i]));
  console.log(`${name}: u=${JSON.stringify(u)} x40=[${xs[STEPS].map(v => v.toFixed(4)).join(", ")}] x*=[${xStar.map(v => v.toFixed(4)).join(", ")}] ||x40-x*||2=${dist.toFixed(6)}`);
  if (name === "default") assert(dist < 0.01, `default: ||x40 - x*||2 < 0.01 (got ${dist})`);
}

// ---------- 3. Spectral radius ----------
section("spectral radius rho(A)");
const eig = jacobiEigenvalues(A);
const rhoJacobi = Math.max(...eig.map(Math.abs));
const rhoPower = powerIterationRho(A);
console.log(`Jacobi eigenvalues: [${eig.map(v => v.toFixed(6)).join(", ")}] rho=${rhoJacobi.toFixed(6)}`);
console.log(`Power-iteration rho: ${rhoPower.toFixed(6)}`);
assert(rhoJacobi < 1, `rho(A) < 1 via Jacobi (got ${rhoJacobi})`);
assert(rhoPower < 1, `rho(A) < 1 via power iteration (got ${rhoPower})`);
assert(Math.abs(rhoPower - rhoJacobi) < 1e-6, `power iteration agrees with Jacobi on rho (diff ${Math.abs(rhoPower - rhoJacobi)})`);

// ---------- 4. Page's displayed eigenvalue string ----------
section("page displayed eigenvalue string");
assert(html.includes("eigString()"), "page renders the model eigString()");

const pageEig = eigenvaluesSym(A);
const pageRho = Math.max(...pageEig.map(Math.abs));
const fmt3 = v => v.toFixed(3);
const displayed0 = `eigenvalues λ(A) = ${pageEig.map(v => fmt3(v)).join(", ")}  ·  spectral radius ρ(A)=${fmt3(pageRho)}`;
const displayed = M.eigString().split(" < 1")[0].split(" ≥ 1")[0];
console.log(`page would display: ${displayed}`);
console.log(`test computed     : eigenvalues λ(A) = ${eig.map(v => fmt3(v)).join(", ")}  ·  spectral radius ρ(A)=${fmt3(rhoJacobi)}`);
assert(pageEig.length === eig.length, "page and test both produce 4 eigenvalues");
pageEig.forEach((v, i) => assert(Math.abs(v - eig[i]) <= 1e-3, `eigenvalue ${i}: page ${v} vs test ${eig[i]} within 1e-3`));
assert(displayed === `eigenvalues λ(A) = ${eig.map(v => fmt3(v)).join(", ")}  ·  spectral radius ρ(A)=${fmt3(rhoJacobi)}`,
  "page displayed eigenvalue string matches test-computed values (3-decimal display tolerance)");


// ---------- 5. Fonts local + wording positions + readout precision + OFL ----------
section("self-hosted fonts, OFL, disclaimer wording, readout precision, matrix layout");
{
  const fs = await import("node:fs");
  const f = n => new URL(n, import.meta.url);
  assert(!/fonts\.googleapis|fonts\.gstatic/.test(html), "no Google Fonts CDN references in index.html");
  const urls = [...html.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map(m => m[1]);
  assert(urls.length >= 6, `@font-face uses local fonts/ woff2 files (found ${urls.length})`);
  urls.forEach(u => assert(fs.existsSync(f(u)) && fs.statSync(f(u)).size > 10000, `font file exists: ${u}`));
  ["PlayfairDisplay","EBGaramond","Inter","JetBrainsMono"].forEach(n => assert(fs.existsSync(f(`fonts/OFL-${n}.txt`)) && fs.readFileSync(f(`fonts/OFL-${n}.txt`), "utf8").includes("SIL OPEN FONT LICENSE"), `OFL text bundled: fonts/OFL-${n}.txt`));
  assert(/Georgia,serif/.test(html), "system serif fallback kept");
  const eqPos = html.indexOf('id="eqh"'), disc = html.indexOf('class="disclaimer"'), foot = html.indexOf('<footer>');
  assert(disc < eqPos && html.slice(disc, disc + 200).includes("equations below"), "disclaimer (before equations) says 'equations below'");
  assert(foot > eqPos && html.slice(foot, foot + 200).includes("equations above"), "footer (after equations) says 'equations above'");
  assert(/<meta name="description" content="[^"]*equations on this page/.test(html), "meta description says 'equations on this page'");
  assert(!html.slice(0, eqPos).includes("equations above"), "no 'equations above' anywhere before the equations");
  const readme = fs.readFileSync(f("README.md"), "utf8");
  const pageShows = M.fmtDist(M.distance(defaultU));
  console.log(`page dist readout: ${pageShows}`);
  assert(html.includes("fmtDist(distance(u))") && pageShows === "0.000365", `page readout = model fmtDist (3 s.f.) = ${pageShows}`);
  assert(readme.includes(`≈ ${pageShows}`), `README quotes the exact page readout ${pageShows}`);
  assert(/\#matA,\#matB\{white-space:pre;/.test(html), "matrices use no-wrap + horizontal scroll container");
}

// ---------- Summary ----------
console.log(`\n${passed} assertions passed, ${failures.length} failed`);
if (failures.length) { console.error("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
console.log("PASS: all Draft Dynamics checks passed");
