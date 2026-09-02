import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  drawCircle,
  drawRoundedRectangle,
  fuseAll,
  isSolid,
  measureVolume,
  unwrap,
} from '../p5-surface.js';
import { initOC } from '../kernel-setup.js';

beforeAll(async () => {
  await initOC();
}, 30000);

// Regression guard for the chainable surface of `Drawing.sketchOnPlane(...)`,
// which is typed `SketchInterface | Sketches`. Both branches must expose the
// full set of chain ops (extrude/revolve/loftWith/sweepSketch), and the batch
// boolean ops must accept the Shape3D those ops return — the patterns the
// playground examples and docs rely on. These calls failing to type-check is
// itself the regression; the runtime asserts they still produce solids.
describe('sketchOnPlane chainable surface', () => {
  const r = (inset: number, z: number) =>
    drawRoundedRectangle(40 - 2 * inset, 40 - 2 * inset, 3.75 - inset).sketchOnPlane('XY', z);

  it('lofts between sketchOnPlane results', () => {
    const foot = r(0, 0).loftWith([r(2.15, -2.4), r(2.95, -5)], { ruled: true });
    expect(isSolid(foot)).toBe(true);
    expect(unwrap(measureVolume(foot))).toBeGreaterThan(0);
  });

  it('fuseAll accepts extrude/loft (Shape3D) results without an unsafe flag', () => {
    const body = r(0, 0).extrude(15);
    const foot = r(0, 0).loftWith([r(2.15, -2.4)], { ruled: true });
    const fused = unwrap(fuseAll([body, foot]));
    expect(unwrap(measureVolume(fused))).toBeGreaterThan(0);
  });

  it('sweeps a profile from a sketchOnPlane callback', () => {
    // occt-wasm 3.8.4 lacks sweepAdvanced → the adapter warns that transitionMode is ignored.
    // Spy and assert it (CI stderr zero-tolerance; a future occt-wasm upgrade can drop this).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const swept = drawCircle(20)
        .sketchOnPlane('XY')
        .sweepSketch((plane) => drawCircle(2).sketchOnPlane(plane));
      expect(unwrap(measureVolume(swept))).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  });
});
