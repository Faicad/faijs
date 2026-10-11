/**
 * P7/D3: canonical-pose mode of compareStepFiles.
 *
 * Constructs two STEP files that are two LEGAL solutions of an underdetermined
 * constraint set: a single box, B = A twisted 45° about the free axis (0,1,1)
 * through its COM. The solver's DOF diagnostic (P7/D1) is exactly what labels
 * such a pair "underdetermined"; the canonical channel must:
 *  - PASS the twisted pair (twist is a free DOF, not a defect) — audit field
 *    records the aligned angle ≈ ±45° (mod 360°),
 *  - FAIL a pair perturbed in a CONSTRAINED DOF (rotation about a fixed axis,
 *    or translation along a constrained direction) — no canonical rescue.
 *  - default 'bitwise' mode still rejects the twisted pair (zero regression).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getBackends } from '@faicad/faijs/runtime-state'
import { brepOf } from '@faicad/faijs/shape'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as cq from '@faicad/faijs-cadquery'
import { asPartName } from '@faicad/faijs/identity'
import { compareStepFiles } from '../src/index'

let fa: string
let fTwisted: string
let fPerturbed: string

function rodrigues(axis: [number, number, number], deg: number): number[] {
  const len = Math.hypot(...axis)
  const [ax, ay, az] = [axis[0] / len, axis[1] / len, axis[2] / len]
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const t = 1 - c
  return [
    c + ax * ax * t, ax * ay * t - az * s, ax * az * t + ay * s, 0,
    ay * ax * t + az * s, c + ay * ay * t, ay * az * t - ax * s, 0,
    az * ax * t - ay * s, az * ay * t + ax * s, c + az * az * t, 0,
  ]
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  const runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/faijs-cadquery' } as never)
  const res = await runtime.execute([
    "import * as cq from '@faicad/faijs-cadquery'",
    'let b = cq.val(cq.box(cq.Workplane("XY"), 10, 4, 2))',
  ].join('\n'))
  expect(res.failedAt).toBeUndefined()
  const box = brepOf(res.outputs.get(asPartName('b')) as never)

  const kernel = getBackends().kernel.brep as {
    transform: (h: unknown, m: number[]) => unknown
    makeCompound: (a: unknown[]) => unknown
    exportStep: (h: unknown) => string
  }
  const compA = kernel.makeCompound([box])
  const twisted = kernel.transform(box, rodrigues([0, 1, 1], 45))
  const compTwisted = kernel.makeCompound([twisted])
  // constrained-DOF defect: rotate about a FIXED axis (X) — canonical channel
  // scans only (0,1,1), cannot absorb this
  const perturbed = kernel.transform(box, rodrigues([1, 0, 0], 45))
  const compPerturbed = kernel.makeCompound([perturbed])

  const dir = mkdtempSync(join(tmpdir(), 'canon-pose-'))
  fa = join(dir, 'a.stp')
  fTwisted = join(dir, 'twisted.stp')
  fPerturbed = join(dir, 'perturbed.stp')
  writeFileSync(fa, kernel.exportStep(compA))
  writeFileSync(fTwisted, kernel.exportStep(compTwisted))
  writeFileSync(fPerturbed, kernel.exportStep(compPerturbed))
}, 120000)

describe('cq-compat: step-compare canonical-pose mode (P7/D3)', () => {
  it('twisted (free DOF) pair → EQUIVALENT with audit field; bitwise still rejects', async () => {
    // sanity: default bitwise mode rejects the twist (zero regression)
    const rb = await compareStepFiles(fa, fTwisted)
    expect(rb.equivalent).toBe(false)
    expect(rb.canonicalPose).toBeUndefined()

    const r = await compareStepFiles(fa, fTwisted, {
      poseMode: 'canonical-pose',
      canonicalFreeAxis: { x: 0, y: 1, z: 1 },
    })
    expect(r.equivalent).toBe(true)
    expect(r.canonicalPose).toBeDefined()
    // aligned twist ≈ ±45° (mod 360°)
    const ang = r.canonicalPose!.twistAngleDeg % 360
    const dev = Math.min(Math.abs(ang - 45), Math.abs(ang + 315), Math.abs(ang - 405), Math.abs(360 - ang - 45))
    expect(dev).toBeLessThan(0.5)
    // invariants stayed bitwise: volume identical
    expect(r.volume.match).toBe(true)
  }, 120000)

  it('perturbed constrained DOF → NOT equivalent (no canonical rescue)', async () => {
    const r = await compareStepFiles(fa, fPerturbed, {
      poseMode: 'canonical-pose',
      canonicalFreeAxis: { x: 0, y: 1, z: 1 },
    })
    expect(r.equivalent).toBe(false)
  }, 120000)

  it('canonical-pose without axis → explicit error (no silent fallback)', async () => {
    await expect(compareStepFiles(fa, fTwisted, { poseMode: 'canonical-pose' })).rejects.toThrow(/canonicalFreeAxis/)
  }, 120000)
})
