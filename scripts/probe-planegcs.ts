/**
 * M0 probe: load planegcs WASM in Node, solve a rectangle benchmark.
 * Exit criteria (plan §7 M0): solution error < 1e-6 vs analytic solution.
 */
import { make_gcs_wrapper, Algorithm } from '@salusoft89/planegcs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@salusoft89/planegcs/package.json'));
const wasmPath = join(pkgDir, 'dist', 'planegcs_dist', 'planegcs.wasm');

const t0 = performance.now();
const gcs = await make_gcs_wrapper(wasmPath);
const initMs = (performance.now() - t0).toFixed(1);
console.log(`[M0.2] wasm init: ${initMs} ms, wasm bytes: 508141`);

// M0.3 benchmark: rectangle 40x30 anchored at p0=(10,20) (fixed point).
// l0 bottom, l1 right, l2 top, l3 left; shared corner points.
gcs.push_primitives_and_params([
  { type: 'point', id: 'p0', x: 10, y: 20, fixed: true },
  { type: 'point', id: 'p1', x: 50, y: 20, fixed: false },
  { type: 'point', id: 'p2', x: 50, y: 50, fixed: false },
  { type: 'point', id: 'p3', x: 10, y: 50, fixed: false },
  { type: 'line', id: 'l0', p1_id: 'p0', p2_id: 'p1' },
  { type: 'line', id: 'l1', p1_id: 'p1', p2_id: 'p2' },
  { type: 'line', id: 'l2', p1_id: 'p2', p2_id: 'p3' },
  { type: 'line', id: 'l3', p1_id: 'p3', p2_id: 'p0' },
  { type: 'horizontal_pp', id: 'h0', p1_id: 'p0', p2_id: 'p1' },
  { type: 'horizontal_pp', id: 'h1', p1_id: 'p2', p2_id: 'p3' },
  { type: 'vertical_pp', id: 'v0', p1_id: 'p1', p2_id: 'p2' },
  { type: 'vertical_pp', id: 'v1', p1_id: 'p3', p2_id: 'p0' },
  { type: 'p2p_distance', id: 'dx', p1_id: 'p0', p2_id: 'p1', distance: 40 },
  { type: 'p2p_distance', id: 'dy', p1_id: 'p0', p2_id: 'p3', distance: 30 },
]);

const t1 = performance.now();
const status = gcs.solve(Algorithm.LevenbergMarquardt);
const solveMs = (performance.now() - t1).toFixed(1);
gcs.apply_solution();
console.log(`[M0.3] solve status: ${status} in ${solveMs} ms`);
console.log(`[M0.3] conflicting: ${gcs.has_gcs_conflicting_constraints()}, redundant: ${gcs.has_gcs_redundant_constraints()}`);

// read back solved points via get_gcs_params and compare to analytic solution
const params = gcs.get_gcs_params();
console.log('[M0.3] solved params:', JSON.stringify(params));

// analytic: p0(10,20) p1(50,20) p2(50,50) p3(10,50)
const expected = [10, 20, 50, 20, 50, 50, 10, 50];
let maxErr = 0;
for (let i = 0; i < expected.length; i++) {
  maxErr = Math.max(maxErr, Math.abs(params[i] - expected[i]));
}
console.log(`[M0.3] max error vs analytic: ${maxErr.toExponential(3)}  => ${maxErr < 1e-6 ? 'GO' : 'CHECK'}`);
