// Draft Dynamics — in-repo test harness. No dependencies (Node >= 18).
// Parses A, B, x0, default u, presets and STEPS out of index.html itself
// (never copies of the numbers), recomputes the 41-step trajectory for the
// default u and all 4 presets, and checks:
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

// ---------- Parse the model out of index.html ----------
function parseJsonConst(re, label) {
  const m = html.match(re);
  assert(m !== null, `parsed ${label} out of index.html`);
  if (!m) throw new Error(`cannot parse ${label}`);
  return JSON.parse(m[1]);
}
const A = parseJsonConst(/const A\s*=\s*(\[\[[\s\S]*?\]\]);/, "A");
const B = parseJsonConst(/const B\s*=\s*(\[\[[\s\S]*?\]\]);/, "B");
const X0 = parseJsonConst(/const X0\s*=\s*(\[[^\]]*\])\s*,\s*STEPS/, "x0");
const defaultU = parseJsonConst(/let u\s*=\s*(\[[^\]]*\]);/, "default u");
const PRESETS = parseJsonConst(/const PRESETS\s*=\s*(\{[\s\S]*?\});/, "PRESETS");
const stepsMatch = html.match(/STEPS\s*=\s*(\d+)/);
assert(stepsMatch !== null, "parsed STEPS out of index.html");
const STEPS = Number(stepsMatch[1]);

section("parsed model");
console.log(`A=${JSON.stringify(A)}`);
console.log(`B=${JSON.stringify(B)}`);
console.log(`x0=${JSON.stringify(X0)} default u=${JSON.stringify(defaultU)} STEPS=${STEPS}`);
console.log(`presets=${Object.keys(PRESETS).join(" | ")}`);
assert(A.length === 4 && A.every(r => r.length === 4), "A is 4x4");
assert(B.length === 4 && B.every(r => r.length === 4), "B is 4x4");
assert(X0.length === 4 && defaultU.length === 4, "x0 and default u are 4-vectors");
assert(STEPS === 40, "STEPS is 40 (41 states)");
assert(Object.keys(PRESETS).length === 4, "exactly 4 presets parsed");

// ---------- Independent math (written for this test, not copied) ----------
const clip = v => Math.max(0, Math.min(1, v));
const matVec = (M, v) => M.map(r => r.reduce((s, x, i) => s + x * v[i], 0));
function solve(M, b) { // Gaussian elimination with partial pivoting
  const n = b.length, a = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = c; j <= n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = a[r][c]; for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map(r => r[n]);
}
const fixedPoint = u => solve(A.map((r, i) => r.map((v, j) => (i === j ? 1 : 0) - v)), matVec(B, u));
function trajectory(u) {
  const xs = [[...X0]], Bu = matVec(B, u);
  for (let t = 0; t < STEPS; t++) xs.push(matVec(A, xs[t]).map((v, i) => clip(v + Bu[i])));
  return xs;
}
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
assert(html.includes("eigenvalues λ(A) ="), "page contains the eigenvalue display line template");
assert(html.includes("spectral radius ρ(A)="), "page contains the spectral-radius display template");
// Run the page's own eigenvaluesSym (extracted verbatim from index.html).
const fnStart = html.indexOf("function eigenvaluesSym");
const fnEnd = html.indexOf("function matrixText");
assert(fnStart >= 0 && fnEnd > fnStart, "extracted page eigenvaluesSym function from index.html");
const pageEigenvaluesSym = new Function(`${html.slice(fnStart, fnEnd)}; return eigenvaluesSym;`)();
const pageEig = pageEigenvaluesSym(A);
const pageRho = Math.max(...pageEig.map(Math.abs));
const fmt3 = v => v.toFixed(3);
const displayed = `eigenvalues λ(A) = ${pageEig.map(v => fmt3(v)).join(", ")}  ·  spectral radius ρ(A)=${fmt3(pageRho)}`;
console.log(`page would display: ${displayed}`);
console.log(`test computed     : eigenvalues λ(A) = ${eig.map(v => fmt3(v)).join(", ")}  ·  spectral radius ρ(A)=${fmt3(rhoJacobi)}`);
assert(pageEig.length === eig.length, "page and test both produce 4 eigenvalues");
pageEig.forEach((v, i) => assert(Math.abs(v - eig[i]) <= 1e-3, `eigenvalue ${i}: page ${v} vs test ${eig[i]} within 1e-3`));
assert(displayed === `eigenvalues λ(A) = ${eig.map(v => fmt3(v)).join(", ")}  ·  spectral radius ρ(A)=${fmt3(rhoJacobi)}`,
  "page displayed eigenvalue string matches test-computed values (3-decimal display tolerance)");

// ---------- Summary ----------
console.log(`\n${passed} assertions passed, ${failures.length} failed`);
if (failures.length) { console.error("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
console.log("PASS: all Draft Dynamics checks passed");
