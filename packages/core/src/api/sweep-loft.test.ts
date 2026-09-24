/**
 * @vitest-environment node
 *
 * sweep / loft / complexExtrude / twistExtrude / roof — Phase 4（扫掠 / 放样族）验收
 *
 * 覆盖：
 * 1. sweep 可达：截面为面（sketch）→ 取外环（输入适配路径）；
 * 2. sweep 可达：截面为 1D wire（kind='curve' 直通，Phase 3 判别位消费侧）；
 * 3. loft 可达：多截面蒙皮；截面可为面或 wire；
 * 4. complexExtrude / twistExtrude / roof 上脚本面可达；
 * 5. 平台 op 平台身份：brepkit（非目标引擎）下**执行前**报 E_BREP_UNSUPPORTED（D11-4）；
 * 6. 平台 op 在 brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 7. roof 是中立 op（capabilities 路由，非 engines）——brep_mock 下同样不被平台判定拦截。
 *
 * GOTCHA-1（Phase 4 实测）：vendored `complexExtrude(wire, center, normal, profile?, shellMode?)`
 * 的 `normal` 同时是**挤出向量**（`extrusionLength = vecLength(normal)`），不是单位方向；
 * 传 `[0,0,30]` 即沿 +Z 拉伸 30mm。`center` 是脊柱起点。`shellMode` 不暴露（元组产物）。
 *
 * GOTCHA-2（Phase 4 实测，D11-4 用例的输入选择）：brepkit 的能力表**没有 `makeWire`**
 * （`brep/engine/adapters/brepkit.ts` 声明 `makeLineEdge` 但无 `makeWire`），所以
 * `cad.wire` 在 brepkit 下会先挂 —— 用 wire 作输入会让失败点落在 `wire` 而不是被测 op。
 * 引擎门用例只需输入**能在 brepkit 上构造**（该用例只验引擎身份判定，不验几何），
 * 故用 `cad.cylinder`（brepkit 声明了 `makeCylinder`）而非 wire。
 *
 * GOTCHA-3（Phase 4 实测，报错文案）：defineOp 声明了 `name` 时引擎门文案是
 * `E_BREP_UNSUPPORTED: op '<name>' requires engine occt (current=<engine>)`；
 * 未声明 name 的 op（如 helix/wire）文案退化为 `op requires engine occt`。
 * 断言用 `/op '<name>' requires engine occt/`，不要写 `/op requires engine occt/`。
 *
 * GOTCHA-4（Phase 4 实测，上游告警）：occt-wasm 3.x 缺 `sweepAdvanced` ⇒ vendored
 * `sweep`（`sweepFns.ts` 的 `transitionMode` 默认值 'right'）会丢弃该选项并
 * `console.warn` **一次**（`warnedOnce` 去重，故只能文件级断言）。`complexExtrude` /
 * `twistExtrude` 内部也走 vendored `sweep`。CI 对 stderr 零容忍 ⇒ 本文件 spy + 断言
 * （同 `packages/tests/faijs/p5-vendored-surface/tests/sweepFns.test.ts` 口径）；
 * occt-wasm 升到 >= 4.1.0 后可删掉这层。
 *
 * Run: npx vitest run src/api/sweep-loft.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../brep/engine/adapters/brepkit'
import { registerBrepMockEngine } from '../brep/engine/adapters/brep-mock'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'

/** 捕获的上游（vendored/occt-wasm）console.warn 内容，见文件头 GOTCHA-4。 */
const upstreamWarns: unknown[][] = []

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    upstreamWarns.push(args)
  })
  await initOcctWasm()
}, 120000)

afterAll(() => {
  // spy 必须有所捕获：sweep / complexExtrude / twistExtrude 确实走 vendored 内核。
  // 且逐条核对内容 —— 只允许"occt-wasm 版本能力不足"这一族上游告警，
  // 出现别的告警（真实噪声）即失败，不是无条件静默。
  expect(upstreamWarns.length).toBeGreaterThan(0)
  for (const args of upstreamWarns) {
    expect(String(args[0])).toMatch(/^occt-wasm: /)
  }
  vi.restoreAllMocks()
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 重置注册表并注册 occt（默认引擎）。 */
async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

/** 只注册 brepkit（非目标引擎，用于 D11-4 门控用例）。 */
async function useBrepkit(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
}

/** 只注册 brep_mock（D11-3 豁免用例）。 */
async function useBrepMock(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerBrepMockEngine()
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() })
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return makeRuntime(mode).execute(code)
}

/** 执行代码并取回命名产物（失败即抛）。 */
async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

/** 产物 BREP 包围盒（无 brep 槽即抛）。 */
function bboxOf(s: Shape): { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number } {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}

/** 闭合方框 wire 的字面量（中立 op，便于引擎无关构造）。 */
function closedWire(half: number, z = 0): string {
  return (
    `cad.wire([[${-half},${-half},${z}],[${half},${-half},${z}],` +
    `[${half},${half},${z}],[${-half},${half},${z}]], { closed: true })`
  )
}

/** 方框 sketch 面（2D 截面，走「面 → 外环」适配路径）。 */
function squareSketch(half: number): string {
  return (
    'cad.sketch({ contours: [{ segments: [ ' +
    `{ kind: "line", x1: ${-half}, y1: ${-half}, x2: ${half}, y2: ${-half} }, ` +
    `{ kind: "line", x1: ${half}, y1: ${-half}, x2: ${half}, y2: ${half} }, ` +
    `{ kind: "line", x1: ${half}, y1: ${half}, x2: ${-half}, y2: ${half} }, ` +
    `{ kind: "line", x1: ${-half}, y1: ${half}, x2: ${-half}, y2: ${-half} } ] }] })`
  )
}

/**
 * 引擎门控用例的「可构造输入」：cylinder 是中立 dual op（无 capabilities/engines），
 * brepkit 声明了 makeCylinder ⇒ 两个 cylinder 必然能在 brepkit 上造出来，
 * 从而保证失败点落在被测 op 上（见文件头 GOTCHA-2）。
 */
const NEUTRAL_INPUTS = 'let part0 = cad.cylinder(4, 20)\nlet part1 = cad.cylinder(2, 10)\n'

describe('sweep — 截面沿脊柱扫掠（平台 op engines:["occt"]）', () => {
  it('截面为 2D 面（sketch）→ 取外环；可达且几何合理', async () => {
    await useOcct()
    const code =
      `let part0 = ${squareSketch(4)}\n` +
      'let part1 = cad.wire([[0,0,0],[0,0,50]])\n' +
      'let part2 = cad.sweep(part0, part1)\n'
    const s = await shapeOf('brep', code, 'part2')
    const bbox = bboxOf(s)
    // 8×8 方截面沿 +Z 扫 50 → XY ±4、Z ∈ [0,50]
    expect(bbox.xmax).toBeGreaterThanOrEqual(3.9)
    expect(bbox.xmin).toBeLessThanOrEqual(-3.9)
    expect(Math.abs(bbox.zmin)).toBeLessThanOrEqual(0.1)
    expect(bbox.zmax).toBeGreaterThanOrEqual(49.9)
    expect(bbox.zmax).toBeLessThanOrEqual(50.1)
  })

  it('截面为 1D wire（kind="curve" 直通）→ 可达', async () => {
    await useOcct()
    const code =
      `let part0 = ${closedWire(5)}\n` +
      'let part1 = cad.wire([[0,0,0],[0,0,30]])\n' +
      'let part2 = cad.sweep(part0, part1)\n'
    const s = await shapeOf('brep', code, 'part2')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    expect(bbox.zmax).toBeGreaterThanOrEqual(29.9)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    await useBrepkit()
    const result = await exec('brep', NEUTRAL_INPUTS + 'let part2 = cad.sweep(part0, part1)\n')
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('sweep')
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'sweep' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    await useBrepMock()
    const result = await exec('brep', NEUTRAL_INPUTS + 'let part2 = cad.sweep(part0, part1)\n')
    // 豁免语义 = 报错形态必不是"引擎不匹配"（与 brepkit 用例对照）。
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})

describe('loft — 多截面蒙皮（平台 op engines:["occt"]）', () => {
  it('两个 2D 面截面 → 可达且几何合理', async () => {
    await useOcct()
    const code =
      `let part0 = ${squareSketch(5)}\n` +
      `let part1 = cad.translate(${squareSketch(3)}, [0,0,20])\n` +
      'let part2 = cad.loft([part0, part1])\n'
    const s = await shapeOf('brep', code, 'part2')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    expect(bbox.xmax).toBeLessThanOrEqual(5.1)
    expect(bbox.zmax).toBeGreaterThanOrEqual(19.9)
    expect(bbox.zmax).toBeLessThanOrEqual(20.1)
  })

  it('两个 1D wire 截面 → 可达（数组入参 + 1D 直通）', async () => {
    await useOcct()
    const code =
      `let part0 = ${closedWire(5)}\n` +
      `let part1 = ${closedWire(2, 10)}\n` +
      'let part2 = cad.loft([part0, part1])\n'
    const s = await shapeOf('brep', code, 'part2')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    expect(bbox.zmax).toBeGreaterThanOrEqual(9.9)
  })

  it('brepkit 引擎：非目标引擎执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    await useBrepkit()
    const result = await exec('brep', NEUTRAL_INPUTS + 'let part2 = cad.loft([part0, part1])\n')
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('loft')
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'loft' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })

  it('brep_mock 引擎：不被平台身份判定拦截（D11-3 豁免）', async () => {
    await useBrepMock()
    const result = await exec('brep', NEUTRAL_INPUTS + 'let part2 = cad.loft([part0, part1])\n')
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})

describe('complexExtrude / twistExtrude — 脚本面可达（平台 op engines:["occt"]）', () => {
  it('complexExtrude：wire + center + normal(挤出向量) → 可达', async () => {
    await useOcct()
    const code =
      `let part0 = ${closedWire(4)}\n` +
      'let part1 = cad.complexExtrude(part0, [0,0,0], [0,0,25])\n'
    const s = await shapeOf('brep', code, 'part1')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(3.9)
    expect(bbox.zmax).toBeGreaterThanOrEqual(24.9)
    expect(bbox.zmax).toBeLessThanOrEqual(25.1)
  })

  it('twistExtrude：wire + 扭转角 + center + normal → 可达', async () => {
    await useOcct()
    const code =
      `let part0 = ${closedWire(4)}\n` +
      'let part1 = cad.twistExtrude(part0, 90, [0,0,0], [0,0,25])\n'
    const s = await shapeOf('brep', code, 'part1')
    const bbox = bboxOf(s)
    expect(bbox.zmax).toBeGreaterThanOrEqual(24.9)
    expect(bbox.zmax).toBeLessThanOrEqual(25.1)
  })

  it('brepkit 引擎：complexExtrude 执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    await useBrepkit()
    const result = await exec(
      'brep',
      NEUTRAL_INPUTS + 'let part2 = cad.complexExtrude(part0, [0,0,0], [0,0,25])\n',
    )
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('complexExtrude')
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'complexExtrude' requires engine occt/)
  })

  it('brepkit 引擎：twistExtrude 执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    await useBrepkit()
    const result = await exec(
      'brep',
      NEUTRAL_INPUTS + 'let part2 = cad.twistExtrude(part0, 90, [0,0,0], [0,0,25])\n',
    )
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('twistExtrude')
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'twistExtrude' requires engine occt/)
  })
})

describe('roof — 中立 op（capabilities 路由，非 engines）', () => {
  it('occt 引擎：平面闭合 wire（≥3 边）→ 可达，产出实体', async () => {
    await useOcct()
    const code = `let part0 = ${closedWire(5)}\nlet part1 = cad.roof(part0)\n`
    const s = await shapeOf('brep', code, 'part1')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    // 45° 坡度：脊线抬起，Z 上界为正
    expect(bbox.zmax).toBeGreaterThan(0)
  })

  it('brep_mock 引擎：中立 op 不做平台身份拦截（无 engines 声明）', async () => {
    await useBrepMock()
    const result = await exec('brep', 'let part0 = cad.cylinder(4, 20)\nlet part1 = cad.roof(part0)\n')
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})
