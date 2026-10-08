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
 * 7. roof 是平台 op（`engines:['occt']`；2026-10-08 前靠 `capabilities` 门控，判决不变）
 *    —— brep_mock 下受 D11-3 豁免，仍不被引擎门拦截。
 *
 * S3 增补（方案 §3.4.3）：`sweep` 扩 sweepFull 完整控制面（law / orientation /
 * transition / tolerance），旧路径行为不变 + 冲突与入参校验，见文件尾部独立 describe。
 *
 * GOTCHA-1（Phase 4 实测）：旧 `complexExtrude(wire, center, normal, profile?, shellMode?)`
 * 的 `normal` 同时是**挤出向量**（`extrusionLength = vecLength(normal)`），不是单位方向；
 * 传 `[0,0,30]` 即沿 +Z 拉伸 30mm。`center` 是脊柱起点。`shellMode` 不暴露（元组产物）。
 *
 * GOTCHA-2（Phase 4 实测，D11-4 用例的输入选择）：brepkit 侧 `cad.wire` 会先挂 ——
 * 用 wire 作输入会让失败点落在 `wire` 而不是被测 op。
 * 引擎门用例只需输入**能在 brepkit 上构造**（该用例只验引擎身份判定，不验几何），
 * 故用 `cad.cylinder`（brepkit 实现面可用）而非 wire。
 *
 * GOTCHA-3（Phase 4 实测，报错文案）：defineOp 声明了 `name` 时引擎门文案是
 * `E_BREP_UNSUPPORTED: op '<name>' requires engine occt (current=<engine>)`；
 * 未声明 name 的 op（如 helix/wire）文案退化为 `op requires engine occt`。
 * 断言用 `/op '<name>' requires engine occt/`，不要写 `/op requires engine occt/`。
 *
 * GOTCHA-4（Phase 4 实测 → G5 已过时，断言同步收紧）：occt-wasm 3.x 缺
 * `sweepAdvanced` ⇒ 旧 `sweep` 会丢弃 transitionMode 并 `console.warn`。
 * core-decouple G5 后 sweep/complexExtrude/twistExtrude/loft 全部走 core 直连
 * （brep-operations + occt-wasm 原生），不再有旧上游 ⇒ 本文件 spy 断言
 * 改为「warns === 0」（出现告警即失败，防真实噪声静默；出现时逐条核对前缀）。
 *
 * Run: npx vitest run src/api/sweep-loft.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { registerBrepMockEngine } from '../../src/brep/engine/adapters/brep-mock'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

/** 捕获的上游（compat/occt-wasm）console.warn 内容，见文件头 GOTCHA-4。 */
const upstreamWarns: unknown[][] = []

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    upstreamWarns.push(args)
  })
  await initOcctWasm()
}, 120000)

afterAll(() => {
  // G5（core-decouple）：sweep/complexExtrude/twistExtrude/loft 全部走 core 直连
  // （brep-operations + occt-wasm 原生），不再有旧上游 ⇒ 不应产生任何
  // console.warn。若未来重新出现上游告警，逐条核对必须带 "occt-wasm: " 前缀
  // （防真实噪声静默），否则即失败。
  expect(upstreamWarns.length).toBe(0)
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
    'cad.profile({ contours: [{ segments: [ ' +
    `{ kind: "line", x1: ${-half}, y1: ${-half}, x2: ${half}, y2: ${-half} }, ` +
    `{ kind: "line", x1: ${half}, y1: ${-half}, x2: ${half}, y2: ${half} }, ` +
    `{ kind: "line", x1: ${half}, y1: ${half}, x2: ${-half}, y2: ${half} }, ` +
    `{ kind: "line", x1: ${-half}, y1: ${half}, x2: ${-half}, y2: ${-half} } ] }] })`
  )
}

/**
 * 引擎门控用例的「可构造输入」：cylinder 是中立 dual op（无 engines 声明），
 * brepkit 实现面可用 ⇒ 两个 cylinder 必然能在 brepkit 上造出来，
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

describe('roof — 平台 op（engines:["occt"]）', () => {
  it('occt 引擎：平面闭合 wire（≥3 边）→ 可达，产出实体', async () => {
    await useOcct()
    const code = `let part0 = ${closedWire(5)}\nlet part1 = cad.roof(part0)\n`
    const s = await shapeOf('brep', code, 'part1')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    // 45° 坡度：脊线抬起，Z 上界为正
    expect(bbox.zmax).toBeGreaterThan(0)
  })

  it('brep_mock 引擎：D11-3 豁免——替身不被引擎门拦截（2026-10-08 前由能力门拦截，现两条门都不拦）', async () => {
    await useBrepMock()
    const result = await exec('brep', 'let part0 = cad.cylinder(4, 20)\nlet part1 = cad.roof(part0)\n')
    const msg = JSON.stringify(result.failedAt ?? {})
    expect(msg).not.toMatch(/requires engine occt/)
    // 能力声明轴已删除 ⇒ 不可能再出现能力门文案（反面证据）。
    expect(msg).not.toMatch(/lacks capability/)
  })
})

/**
 * S3（方案 §3.4.3）——`sweep` 扩完整控制面：给出 sweepFull 专有字段即走 occt 原生
 * `sweepFull`（occt-wasm 的 sweepAdvanced / sweepOriented 是其子集）。
 *
 * 钉住：
 * 1. law 驱动扫掠（线性缩放律）→ 体积按解析积分收缩（twist 类特征的正确路径，修 F17 根因）；
 * 2. orientation / transitionMode 新名可达；
 * 3. 冲突与入参校验：mode:'simple' × sweepFull 字段、law 缺 lawLength、非法枚举值；
 * 4. 旧路径回归：无 sweepFull 字段时行为不变（transitionMode:'right' 旧别名仍可用）。
 */
describe('sweep（S3）— 扩 sweepFull 完整控制面', () => {
  const PROFILE = `let part0 = ${squareSketch(4)}\nlet part1 = cad.wire([[0,0,0],[0,0,50]])\n`
  const volOf = (s: Shape): number => getBrepApi().getVolume(brepOf(s) as never)

  it('law:"linear" + lawLength + lawEndFactor → 体积按解析积分收缩', async () => {
    await useOcct()
    const plain = await shapeOf('brep', PROFILE + 'let part2 = cad.sweep(part0, part1)\n', 'part2')
    const tapered = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { law: 'linear', lawLength: 50, lawEndFactor: 0.5 })\n",
      'part2',
    )
    const vPlain = volOf(plain)
    const vTaper = volOf(tapered)
    // 无律：8×8 截面 × 50 = 3200
    expect(Math.abs(vPlain)).toBeCloseTo(3200, 0)
    // 线性律 1→0.5：∫₀^50 (1−0.5t/50)² dt = 50·7/12 → V = 64·50·7/12 ≈ 1866.67
    expect(Math.abs(vTaper)).toBeCloseTo(1866.67, 0)
    expect(Math.abs(vTaper)).toBeLessThan(Math.abs(vPlain))
  })

  it('orientation:"frenet" 与默认 orientation:"fixed" 在直线脊柱上几何一致', async () => {
    await useOcct()
    const fixed = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { orientation: 'fixed' })\n",
      'part2',
    )
    const frenet = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { orientation: 'frenet' })\n",
      'part2',
    )
    // 直线脊柱无主法向变化 ⇒ 两模式同几何（体积一致）。
    expect(Math.abs(volOf(frenet) - volOf(fixed))).toBeLessThan(1e-3)
  })

  it('transitionMode:"roundCorner"（新语义名）→ 走 sweepFull，可达', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { transitionMode: 'roundCorner' })\n",
      'part2',
    )
    expect(Math.abs(volOf(s))).toBeGreaterThan(0)
  })

  it('tolerance 项（tol3d / boundTol / tolAngular）可达', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      PROFILE + 'let part2 = cad.sweep(part0, part1, { tol3d: 1e-6, boundTol: 1e-6, tolAngular: 1e-3 })\n',
      'part2',
    )
    expect(Math.abs(volOf(s))).toBeCloseTo(3200, 0)
  })

  it('mode:"simple" × sweepFull 字段 → E_SWEEP_MODE_CONFLICT（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { mode: 'simple', law: 'linear', lawLength: 50 })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SWEEP_MODE_CONFLICT/)
  })

  it('law 非 none 但缺 lawLength → E_SWEEP_LAW_NEEDS_LENGTH（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { law: 'linear' })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SWEEP_LAW_NEEDS_LENGTH/)
  })

  it('非法 orientation → E_SWEEP_BAD_ORIENTATION（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { orientation: 'sideways' })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SWEEP_BAD_ORIENTATION/)
  })

  it('旧路径回归：transitionMode:"right"（旧别名）不报错；非法旧名仍报 E_SWEEP_TRANSITION_UNSUPPORTED', async () => {
    await useOcct()
    const okLegacy = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweep(part0, part1, { transitionMode: 'right' })\n",
      'part2',
    )
    expect(Math.abs(volOf(okLegacy))).toBeCloseTo(3200, 0)
    const bad = await exec('brep', PROFILE + "let part2 = cad.sweep(part0, part1, { transitionMode: 'left' })\n")
    expect(bad.failedAt).toBeDefined()
    expect(JSON.stringify(bad.failedAt)).toMatch(/E_SWEEP_TRANSITION_UNSUPPORTED/)
  })

  it('brepkit 引擎：sweepFull 路径同样被引擎门执行前拒绝（D11-4）', async () => {
    await useBrepkit()
    const result = await exec(
      'brep',
      NEUTRAL_INPUTS + "let part2 = cad.sweep(part0, part1, { law: 'linear', lawLength: 10 })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('sweep')
    expect(JSON.stringify(result.failedAt)).toMatch(/E_BREP_UNSUPPORTED/)
  })
})
