/**
 * compat-op — contract tests (design §6.1: compatOp is a shell over defineOp).
 *
 * Coverage — the requirements the v1 rewrite must uphold:
 *   1. single entry — the compat product is indistinguishable from a defineOp
 *      product: identical `DUAL_OP_META` field set (no self-invented fields);
 *   2. dispatch matrix — brep-only compat op routes identically to a
 *      brep-only defineOp `{mesh,brep,auto} × {chain / off-chain / capability}`;
 *   3. capabilities — the declared capability reaches dispatchPath (brep mode
 *      errors, auto errors with E_MESH_UNSUPPORTED when brep-only);
 *   4. outputs — per-field adoption incl. array fields; `DUAL_OP_META.outputs`
 *      visible; bare-lib admission reads only `fn.outputs`;
 *   5. keep / keepHidden — call-site declarations keep working on compat ops
 *      (UI-layer display contract untouched);
 *   6. slotMap — inherited via the spec and boxed positionally (D11 reverse).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, compat } from '@faicad/faijs'
import {
  configureBackends,
  CONTRACT_VERSION,
  BrepUnsupportedError,
  MeshUnsupportedError,
  type Backends,
} from '../../runtime-state'
import { compatOp } from './compat-op'
import { defineOp, DUAL_OP_META, type DualOpMeta } from '../../define-op'
import { dispatchPath, type BrepCapabilityName } from '../../cad-runtime/backend-dispatch'
import { solid, fromBrep, isShape, hasBrep } from '../../shape'
import { asPartName } from '../../identity'
import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import type { HostPorts } from '../../cad-runtime/ports'
import type { ExecutionResult } from '../../cad-runtime/runtime'
import type { StdlibNamespace } from '../../runtime-state'
import { clone as vendoredClone } from '../generated/topology'
import { registerOcctBrepEngine } from '../../brep/engine/adapters/occt'

type Carried = { [DUAL_OP_META]?: DualOpMeta }

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

function ports(): HostPorts {
  return { events: { emit: () => undefined } }
}

/** Tiny mesh cube (positions/indices) — build off-chain (mesh-only) shapes. */
function cubeMesh(size: number): Shape {
  const s = size / 2
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ])
  return { positions, indices }
}

function makeBackends(mode: 'auto' | 'brep' | 'mesh', caps?: { evolution?: boolean }): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: caps },
    kernel: { brep: null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

function brepOfChain(shape: Shape): Shape {
  return fromBrep(shape, { solid: 1 as unknown as BrepHandle })
}
const onChain = brepOfChain(cubeMesh(5))
const offChain = solid(cubeMesh(5))

/** compat namespace returns a vendored box handle. */
const vendorBox = (compat as unknown as { box: (a: number, b: number, c: number) => unknown }).box

function metaOf(op: unknown): DualOpMeta {
  const m = (op as unknown as Carried)[DUAL_OP_META]
  if (!m) throw new Error('missing DUAL_OP_META')
  return m
}

/** A brepjs-shaped fn body that returns a `{ sun, planets, ring }` handle record. */
function planetaryBody(_params: unknown): { ok: true; value: Record<string, unknown> } {
  const s = (v: number) => vendorBox(v, v, v)
  return { ok: true, value: { sun: s(1), planets: [s(2), s(3)], ring: s(4) } }
}

describe('§ single entry — compat product is a defineOp product', () => {
  it('DUAL_OP_META field set equals defineOp’s; name/capabilities/outputs/schema/slotMap pass through', () => {
    const spec = {
      name: 'mine',
      capabilities: ['evolution'] as BrepCapabilityName[],
      outputs: ['front', 'back'],
      schema: { size: 'number' },
      slotMap: { keys: ['size'] },
    }
    const compatProduct = compatOp((v: unknown) => ({ ok: true, value: v }), spec)
    const defineProduct = defineOp({ brep: () => null as never })
    const cm = metaOf(compatProduct)
    const dm = metaOf(defineProduct)
    expect(Object.keys(cm).sort()).toEqual(Object.keys(dm).sort())
    expect(cm.kind).toBe('dual-op')
    expect(cm.mesh).toBeUndefined()
    expect(cm.name).toBe('mine')
    expect(cm.capabilities).toEqual(['evolution'])
    expect(cm.outputs).toEqual(['front', 'back'])
    expect(cm.schema).toEqual({ size: 'number' })
    expect(cm.slotMap).toEqual({ keys: ['size'] })
  })
})

describe('§ dispatch 矩阵 — 与 brep-only defineOp 一致', () => {
  it('mode×chain：mesh→E_MESH；brep on→brep/off→E_BREP；auto on→brep/off→E_MESH', () => {
    const op = compatOp(() => ({ ok: true, value: null }), { name: 'plain' })
    const meta = metaOf(op)

    configureBackends(makeBackends('mesh'))
    expect(() => dispatchPath([onChain], meta)).toThrow(MeshUnsupportedError)

    configureBackends(makeBackends('brep'))
    expect(dispatchPath([onChain], meta)).toBe('brep')
    expect(() => dispatchPath([offChain], meta)).toThrow(BrepUnsupportedError)

    configureBackends(makeBackends('auto'))
    expect(dispatchPath([onChain], meta)).toBe('brep')
    expect(() => dispatchPath([offChain], meta)).toThrow(MeshUnsupportedError)
  })

  it('capabilities 路由：brep 缺能力→E_BREP；auto 缺能力（brep-only）→E_MESH；具备→brep', () => {
    const op = compatOp(() => ({ ok: true, value: null }), { name: 'capped', capabilities: ['evolution'] })
    const meta = metaOf(op)

    configureBackends(makeBackends('brep', {}))
    expect(() => dispatchPath([onChain], meta, 'evolution')).toThrow(BrepUnsupportedError)

    configureBackends(makeBackends('auto', {}))
    expect(() => dispatchPath([onChain], meta, 'evolution')).toThrow(MeshUnsupportedError)

    configureBackends(makeBackends('auto', { evolution: true }))
    expect(dispatchPath([onChain], meta, 'evolution')).toBe('brep')
  })
})

describe('§4 outputs — 多产物（含数组字段）收养 + meta 可见', () => {
  it('runtime：{sun, planets, ring} 各自收养为 faijs Shape；meta.outputs 可见', async () => {
    const planetary = compatOp((params: unknown) => planetaryBody(params), {
      name: 'planet',
      outputs: ['sun', 'planets', 'ring'],
    })
    const r = createRuntime(ports(), 'auto')
    try {
      r.registerLib(
        'out',
        { contractVersion: CONTRACT_VERSION, planetary } as unknown as StdlibNamespace,
        { compat: true, packageName: 'out-lib' },
      )
      const res = await r.execute("import * as out from 'out-lib'\nconst a1 = out.planetary({ n: 1 })")
      expect(res.failedAt).toBeUndefined()
      const rec = res.activeValues?.get(asPartName('a1')) as
        | { sun?: unknown; planets?: unknown; ring?: unknown }
        | undefined
      expect(rec).toBeDefined()
      expect(isShape(rec!.sun as Shape)).toBe(true)
      expect(hasBrep(rec!.sun as Shape)).toBe(true)
      expect(isShape(rec!.ring as Shape)).toBe(true)
      const planets = rec!.planets as Shape[]
      expect(Array.isArray(planets)).toBe(true)
      expect(planets.length).toBe(2)
      expect(planets.every((p) => isShape(p) && hasBrep(p))).toBe(true)
      expect(metaOf(planetary).outputs).toEqual(['sun', 'planets', 'ring'])
    } finally {
      r.dispose()
    }
  })
})

describe('§6 slotMap — positional boxing inherited via the spec', () => {
  it('位置形态调用被装箱为对象形态（D11 反方向）；meta.slotMap 可见', async () => {
    const seen: number[] = []
    const slotted = compatOp((params: unknown) => {
      seen.push((params as { size: number }).size)
      return { ok: true, value: vendorBox(5, 5, 5) }
    }, { name: 'slotted', slotMap: { keys: ['size'] } })
    expect(metaOf(slotted).slotMap).toEqual({ keys: ['size'] })

    const r = createRuntime(ports(), 'auto')
    try {
      r.registerLib(
        'sl',
        { contractVersion: CONTRACT_VERSION, slotted: slotted as never } as unknown as StdlibNamespace,
        { compat: true, packageName: 'slot-lib' },
      )
      const res = await r.execute(
        "import * as sl from 'slot-lib'\nconst m = sl.slotted(5)\nconst n = sl.slotted({ size: 7 })",
      )
      expect(res.failedAt).toBeUndefined()
      expect(seen).toEqual([5, 7])
    } finally {
      r.dispose()
    }
  })
})

describe('§5 keep — 兼容 op 调用点声明（UI 层显示契约不改）', () => {
  const ns = {
    contractVersion: CONTRACT_VERSION,
    dup: vendoredClone as unknown as (...a: unknown[]) => unknown,
  } as unknown as StdlibNamespace

  async function run(code: string): Promise<ExecutionResult> {
    const r = createRuntime(ports(), 'auto')
    try {
      r.registerLib('gear', ns, { compat: true, packageName: 'gear-lib-demo' })
      return await r.execute(code)
    } finally {
      r.dispose()
    }
  }

  it('兼容 op 调用点 keep 保留几何终端；keepHidden 隐藏', async () => {
    const base = [
      "import * as gear from 'gear-lib-demo'",
      'const part0 = cad.box(20, 20, 20, { centered: true })',
    ].join('\n')

    const kept = await run(base + '\n' + 'const part1 = gear.dup(part0, { keep: ["part0"] })')
    expect(kept.failedAt).toBeUndefined()
    const byId = new Map(kept.terminals.map((t) => [String(t.id), t]))
    expect(byId.has('part0')).toBe(true)
    expect(byId.get('part0')!.hidden).toBeUndefined()
    expect(byId.has('part1')).toBe(true)

    const hidden = await run(base + '\n' + 'const part2 = gear.dup(part0, { keep: ["part0"], keepHidden: true })')
    expect(hidden.failedAt).toBeUndefined()
    const hbyId = new Map(hidden.terminals.map((t) => [String(t.id), t]))
    expect(hbyId.get('part0')!.hidden).toBe(true)
  })
})

describe('§3 admitCompatLib — bare fn 只认 fn.outputs（多产物契约名唯一）', () => {
  it('runtime：裸库 fn.outputs 声明字段各自收养，记录结构保留', async () => {
    const sorting = (_params: unknown) => {
      const s = (v: number) => vendorBox(v, v, v)
      return { ok: true, value: { a: s(1), b: [s(9), s(9)] } }
    }
    ;(sorting as unknown as { outputs?: string[] }).outputs = ['a', 'b']
    const ns = { contractVersion: CONTRACT_VERSION, sorting } as unknown as StdlibNamespace
    const r = createRuntime(ports(), 'auto')
    try {
      r.registerLib('srt', ns, { compat: true, packageName: 'sort-lib' })
      const result = await r.execute("import * as srt from 'sort-lib'\nconst r1 = srt.sorting({ n: 4 })")
      expect(result.failedAt).toBeUndefined()
      const rec = result.activeValues?.get(asPartName('r1')) as { a: unknown; b: unknown } | undefined
      expect(rec).toBeDefined()
      expect(isShape(rec!.a as Shape)).toBe(true)
      expect(Array.isArray(rec!.b)).toBe(true)
    } finally {
      r.dispose()
    }
  })
})