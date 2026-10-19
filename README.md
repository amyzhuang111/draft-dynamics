# Draft Dynamics

A state-space portrait of a writing task — a small, beautiful, deterministic interactive artefact.

**Live:** https://draft-dynamics.vercel.app

## What it is

A deterministic toy model. Numbers come from the equations on the page, not from measured writing.

The draft is a state vector `x = [coherence, evidence, voice, openness] ∈ [0,1]^4`, evolving as

```
x_{t+1} = clip(A x_t + B u),   x0 = [0.32, 0.18, 0.55, 0.80],   t = 0..40
```

where `u = [Research, Cut, Rewrite, Polish]` is set by sliders or preset moves
("Add a source", "Cut a paragraph", "Rewrite intro", "Polish pass").
The 4×4 matrices A and B are defined in `index.html` and printed on the page.
The phase portrait (coherence × evidence, point size = voice, colour deepening
blush → lilac with step) recomputes live, as do the fixed point
`x* = (I − A)^{-1} B u`, the eigenvalues of A (Jacobi iteration for the symmetric
A, in-page), the 4-vector readout, and `‖x40 − x*‖₂`.

## How to run

No build step. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Tests (no dependencies; parses A, B and x0 out of `index.html`, recomputes the
41-step trajectory for the default u and all four presets, checks bounds,
fixed-point convergence, rho(A) < 1, and the displayed eigenvalue string):

```bash
npm test
```

## Math sanity (verified 2026-10-19, America/New_York)

Parsed A and B directly out of `index.html` and recomputed in Python/NumPy:

- Eigenvalues λ(A) ≈ [0.834, 0.677, 0.621, 0.588]; spectral radius ρ(A) ≈ 0.834 < 1 → the unclipped map is stable / contracting.
- Default u = [0.45, 0.35, 0.50, 0.30]: x40 ≈ [0.8091, 0.6536, 0.7461, 0.4428]; x* ≈ [0.8093, 0.6538, 0.7463, 0.4429]; ‖x40 − x*‖₂ ≈ 0.0004.
- All 41 states stay inside [0,1]^4 for the default and all four presets (no clip-boundary hits); every preset fixed point lies inside [0,1]^4.
- Preset x40: Add a source [0.7036, 0.9276, 0.5221, 0.5894] · Cut a paragraph [0.7221, 0.2932, 0.6408, 0.1438] · Rewrite intro [0.9413, 0.6287, 0.9936, 0.5635] · Polish pass [0.7040, 0.4004, 0.6535, 0.1244].

## Tech

Single static `index.html` (inline CSS/JS, Google Fonts). No external data, no tracking.
