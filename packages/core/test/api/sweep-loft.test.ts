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
 * 5. **基础 sweep / loft 两内核都支持**（2026-10-10 双引擎化，方案
 *    2026-10-10-sweep-loft-dual-engine-plan）：occt 走 `sweepPipeShell` / `loft`，
 *    brepkit 走 `sweep(face, NURBS path)` / `loft(faces)` —— brepkit 链上必须**真出
 *    实体**（正面几何用例），不再是引擎门拒绝；
 * 6. brep_mock 下不被引擎判定拦截（D11-3 豁免）；
 * 7. roof 是平台 op（`engines:['occt']`；2026-10-08 前靠 `capabilities` 门控，判决不变）
 *    —— brep_mock 下受 D11-3 豁免，仍不被引擎门拦截。
 *
 * S3 增补（方案 §3.4.3）：sweepFull 完整控制面（law / orientation / transition /
 * tolerance）**已迁到独立平台 op `cad.sweepAdvanced`**（2026-10-10 双引擎化：基础 op
 * 的选项集 = 两内核交集 = 空）；loft 的 `startPoint` / `tolerance` 同理迁到
 * `cad.loftAdvanced`。见文件尾部独立 describe。
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

describe('sweep — 截面沿脊柱扫掠（基础 op：两内核都支持）', () => {
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

  it('brepkit 引擎：**可达**（两内核交集，2026-10-10 双引擎化）—— 真出实体', async () => {
    await useBrepkit()
    const code =
      `let part0 = ${closedWire(4)}\n` +
      'let part1 = cad.wire([[0,0,0],[0,0,25]])\n' +
      'let part2 = cad.sweep(part0, part1)\n'
    const s = await shapeOf('brep', code, 'part2')
    const bbox = bboxOf(s)
    // 8×8 方截面沿 +Z 扫 25 → XY ±4、Z ∈ [0,25]
    expect(bbox.xmax).toBeGreaterThanOrEqual(3.9)
    expect(bbox.xmin).toBeLessThanOrEqual(-3.9)
    expect(Math.abs(bbox.zmin)).toBeLessThanOrEqual(0.1)
    expect(bbox.zmax).toBeGreaterThanOrEqual(24.9)
    expect(bbox.zmax).toBeLessThanOrEqual(25.1)
  })

  it('brep_mock 引擎：不被引擎判定拦截（D11-3 豁免）', async () => {
    await useBrepMock()
    const result = await exec('brep', NEUTRAL_INPUTS + 'let part2 = cad.sweep(part0, part1)\n')
    // 豁免语义 = 报错形态必不是"引擎不匹配"（与平台 op 用例对照）。
    expect(JSON.stringify(result.failedAt ?? {})).not.toMatch(/requires engine occt/)
  })
})

describe('loft — 多截面蒙皮（基础 op：两内核都支持）', () => {
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

  it('brepkit 引擎：**可达**（两内核交集，2026-10-10 双引擎化）—— 真出实体', async () => {
    await useBrepkit()
    // 顶点数不一致的截面（如圆 → 方）由 brepkit 内核重采样兜底（2026-10-14 起）。
    const code =
      `let part0 = ${closedWire(5)}\n` +
      `let part1 = ${closedWire(2, 10)}\n` +
      'let part2 = cad.loft([part0, part1])\n'
    const s = await shapeOf('brep', code, 'part2')
    const bbox = bboxOf(s)
    expect(bbox.xmax).toBeGreaterThanOrEqual(4.9)
    expect(bbox.zmax).toBeGreaterThanOrEqual(9.9)
  })

  it('brep_mock 引擎：不被引擎判定拦截（D11-3 豁免）', async () => {
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
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { law: 'linear', lawLength: 50, lawEndFactor: 0.5 })\n",
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
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { orientation: 'fixed' })\n",
      'part2',
    )
    const frenet = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { orientation: 'frenet' })\n",
      'part2',
    )
    // 直线脊柱无主法向变化 ⇒ 两模式同几何（体积一致）。
    expect(Math.abs(volOf(frenet) - volOf(fixed))).toBeLessThan(1e-3)
  })

  it('transitionMode:"roundCorner"（新语义名）→ 走 sweepFull，可达', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { transitionMode: 'roundCorner' })\n",
      'part2',
    )
    expect(Math.abs(volOf(s))).toBeGreaterThan(0)
  })

  it('tolerance 项（tol3d / boundTol / tolAngular）可达', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      PROFILE + 'let part2 = cad.sweepAdvanced(part0, part1, { tol3d: 1e-6, boundTol: 1e-6, tolAngular: 1e-3 })\n',
      'part2',
    )
    expect(Math.abs(volOf(s))).toBeCloseTo(3200, 0)
  })

  it('mode:"simple" × sweepFull 字段 → E_SWEEP_MODE_CONFLICT（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { mode: 'simple', law: 'linear', lawLength: 50 })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SWEEP_MODE_CONFLICT/)
  })

  it('law 非 none 但缺 lawLength → E_SWEEP_LAW_NEEDS_LENGTH（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { law: 'linear' })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SWEEP_LAW_NEEDS_LENGTH/)
  })

  it('非法 orientation → E_SWEEP_BAD_ORIENTATION（执行前）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { orientation: 'sideways' })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(JSON.stringify(result.failedAt)).toMatch(/E_SWEEP_BAD_ORIENTATION/)
  })

  it('旧路径回归：transitionMode:"right"（旧别名）不报错；非法旧名仍报 E_SWEEP_TRANSITION_UNSUPPORTED', async () => {
    await useOcct()
    const okLegacy = await shapeOf(
      'brep',
      PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { transitionMode: 'right' })\n",
      'part2',
    )
    expect(Math.abs(volOf(okLegacy))).toBeCloseTo(3200, 0)
    const bad = await exec('brep', PROFILE + "let part2 = cad.sweepAdvanced(part0, part1, { transitionMode: 'left' })\n")
    expect(bad.failedAt).toBeDefined()
    expect(JSON.stringify(bad.failedAt)).toMatch(/E_SWEEP_TRANSITION_UNSUPPORTED/)
  })

  it('brepkit 引擎：sweepAdvanced（occt 平台 op）→ 执行前报 E_BREP_UNSUPPORTED（D11-4）', async () => {
    await useBrepkit()
    const result = await exec(
      'brep',
      NEUTRAL_INPUTS + "let part2 = cad.sweepAdvanced(part0, part1, { law: 'linear', lawLength: 10 })\n",
    )
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('sweepAdvanced')
    const msg = JSON.stringify(result.failedAt)
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/op 'sweepAdvanced' requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
  })
})

/**
 * 双引擎化 GOTCHA（方案 2026-10-10-sweep-loft-dual-engine-plan §7.7）。
 *
 * 钉住适配器行为与内核能力——将来适配器行为变化时断言会翻面：
 * 1. 顶点数不一致的截面（如圆 → 方、方 → 三角）在**两内核上都可达**：
 *    brepkit 内核把所有截面重采样到最大顶点数再蒙皮（operations/loft.rs），
 *    occt 原生支持 —— 2026-10-14 移除原 `E_LOFT_SECTION_MISMATCH` 执行前门禁；
 * 2. 脊柱是**解析边**（line/circle）时 `getEdgeNurbsData` 会抛错 ⇒ 适配器
 *    必须先判 `getEdgeCurveType` 再选拟合路线（`wireToSpineEdge` 的 GOTCHA-1）；
 * 3. 脊柱是**折线 wire** 时适配器走「顶点列 + degree=1 插值」的精确表示路线，
 *    不圆化拐角（GOTCHA-2：不走 `kernel.sweep(face, …NURBS 数组)`，其 knots 约定
 *    与本仓 `getNurbsCurveData` 不一致）。
 */
describe('sweep/loft 双引擎化 GOTCHA（方案 §7.7）', () => {
  /** 4 顶点方截面（z=0） + 3 顶点三角截面（z=10）：顶点数不一致。 */
  const MISMATCHED =
    `let s0 = ${closedWire(4)}\n` +
    'let s1 = cad.wire([[0,0,10],[5,0,10],[2.5,5,10]], { closed: true })\n'

  it('brepkit loft：截面顶点数不一致（方 → 三角）→ 内核重采样兜底，真出实体（2026-10-14 门禁移除）', async () => {
    await useBrepkit()
    const s = await shapeOf('brep', MISMATCHED + 'let part2 = cad.loft([s0, s1])\n', 'part2')
    const b = bboxOf(s)
    // 4×4 方（z=0）→ 三角（z=10）：z 跨度 10，xy 由宽的一侧决定（±4）。
    expect(b.zmax).toBeGreaterThanOrEqual(9.9)
    expect(b.zmax).toBeLessThanOrEqual(10.1)
    expect(b.xmax).toBeGreaterThanOrEqual(3.9)
  })

  it('brepkit loft：圆 → 方（1 顶点闭环 vs 4 顶点方框）→ 重采样兜底可达', async () => {
    await useBrepkit()
    // 整圆 sketch 面（4 段 90° 圆弧，r=4，z=0）→ 方框 wire（half=3，z=10）。
    // 弧角度是 ANGLE 槽位（脚本面基准单位 = 度），`* RADIAN` 保持内核原值不变。
    const circleSketch =
      'cad.profile({ contours: [{ segments: [ ' +
      '{ kind: "arc", cx: 0, cy: 0, radius: 4, startAngle: 0*RADIAN, endAngle: 1.5707963267948966*RADIAN, ccw: true, x1: 4, y1: 0, x2: 0, y2: 4 }, ' +
      '{ kind: "arc", cx: 0, cy: 0, radius: 4, startAngle: 1.5707963267948966*RADIAN, endAngle: 3.141592653589793*RADIAN, ccw: true, x1: 0, y1: 4, x2: -4, y2: 0 }, ' +
      '{ kind: "arc", cx: 0, cy: 0, radius: 4, startAngle: 3.141592653589793*RADIAN, endAngle: 4.71238898038469*RADIAN, ccw: true, x1: -4, y1: 0, x2: 0, y2: -4 }, ' +
      '{ kind: "arc", cx: 0, cy: 0, radius: 4, startAngle: 4.71238898038469*RADIAN, endAngle: 6.283185307179586*RADIAN, ccw: true, x1: 0, y1: -4, x2: 4, y2: 0 } ] }] })'
    const code =
      `let s0 = ${circleSketch}\n` +
      `let s1 = ${closedWire(3, 10)}\n` +
      'let part2 = cad.loft([s0, s1])\n'
    const s = await shapeOf('brep', code, 'part2')
    const b = bboxOf(s)
    // 圆 r=4（z=0）→ 方 ±3（z=10）：z 跨度 10；圆侧重采样后极值仍在半径处。
    expect(b.zmax).toBeGreaterThanOrEqual(9.9)
    expect(b.zmax).toBeLessThanOrEqual(10.1)
    expect(b.xmax).toBeGreaterThanOrEqual(3.5)
    expect(b.xmax).toBeLessThanOrEqual(4.1)
  })

  it('occt loft：同一组不等顶点数截面 → **可达**（约束属 brepkit 内核，不是 op 层）', async () => {
    await useOcct()
    const s = await shapeOf('brep', MISMATCHED + 'let part2 = cad.loft([s0, s1])\n', 'part2')
    const b = bboxOf(s)
    // 4×4 方（z=0）→ 三角（z=10）：z 跨度 10，xy 由宽的一侧决定（±4）。
    expect(b.zmax).toBeGreaterThanOrEqual(9.9)
    expect(b.zmax).toBeLessThanOrEqual(10.1)
    expect(b.xmax).toBeGreaterThanOrEqual(3.9)
  })

  it('brepkit sweep：脊柱为单条解析 line 边 → 顶点拟合路线可达（GOTCHA-1 规避）', async () => {
    await useBrepkit()
    const code =
      `let s = ${closedWire(3)}\n` +
      'let sp = cad.wire([[0,0,0],[0,0,20]])\n' +
      'let part2 = cad.sweep(s, sp)\n'
    const b = bboxOf(await shapeOf('brep', code, 'part2'))
    // 6×6 方截面沿 +Z 扫 20 → z ∈ [0,20]、xy ±3。
    expect(b.zmax).toBeGreaterThanOrEqual(19.9)
    expect(b.zmax).toBeLessThanOrEqual(20.1)
    expect(b.xmax).toBeGreaterThanOrEqual(2.9)
  })

  it('brepkit sweep：脊柱为折线 wire（L 形，全解析 line 边）→ degree=1 精确表示，拐角不圆化', async () => {
    await useBrepkit()
    const code =
      `let s = ${closedWire(2)}\n` +
      'let sp = cad.wire([[0,0,0],[0,0,15],[10,0,15]])\n' +
      'let part2 = cad.sweep(s, sp)\n'
    const b = bboxOf(await shapeOf('brep', code, 'part2'))
    // 4×4 方截面沿 L 形路径 → x ∈ [-2,10]、y ∈ [-2,2]、z ∈ [0,15]。
    expect(b.zmax).toBeGreaterThanOrEqual(14.9)
    expect(b.xmax).toBeGreaterThanOrEqual(9.9)
    expect(b.xmin).toBeLessThanOrEqual(-1.9)
  })

  /**
   * 开口截面 wire（方案 §4.1① 预留的 `E_SWEEP_OPEN_PROFILE`）——**实测后未采用**，
   * 这里钉住实测证据，防止将来有人凭方案原文单侧加检查：
   *
   * - 方案 §4.1① 假设「开口 wire 不构成合法截面 ⇒ 执行前报错」，且该假设写在
   *   §4「基础 sweep 的 **brepkit** 实现」下（暗示只在 brepkit 适配器加）。
   * - 实测（2026-10-10）：**occt 与 brepkit 都接受**开口折线截面——适配器
   *   `makeFaceFromWire` / occt `MakePipeShell` 各自把折线按隐式闭合处理，两引擎
   *   产物几何一致（见下方断言）。既然两引擎行为一致，就不是本次双引擎化引入的
   *   分叉；此时**单侧**加 `E_SWEEP_OPEN_PROFILE` 反而会制造 occt/brepkit 分叉
   *   （违反方案 §3「基础 op = 两内核交集」原则）；要做就得两内核一起做，属改变
   *   occt 既有行为的独立决策 —— 未拍板前不动，故本用例钉当前一致行为。
   */
  it('sweep 开口截面 wire：两引擎都按隐式闭合接受，且几何一致（方案 §4.1① 的 E_SWEEP_OPEN_PROFILE 未采用）', async () => {
    const code =
      'let s = cad.wire([[-2,-2,0],[2,-2,0],[2,2,0]])\n' + // 开口（3 点折线，未闭合）
      'let sp = cad.wire([[0,0,0],[0,0,20]])\n' +
      'let part2 = cad.sweep(s, sp)\n'
    await useBrepkit()
    const bk = bboxOf(await shapeOf('brep', code, 'part2'))
    await useOcct()
    const oc = bboxOf(await shapeOf('brep', code, 'part2'))
    // 当前实测：两引擎都把开口折线当隐式闭合截面 → x/y ∈ [-2,2]、z ∈ [0,20]。
    expect(bk.xmax).toBeCloseTo(oc.xmax, 0)
    expect(bk.xmin).toBeCloseTo(oc.xmin, 0)
    expect(bk.zmax).toBeCloseTo(oc.zmax, 0)
    expect(oc.zmax).toBeGreaterThanOrEqual(19.9)
    expect(oc.zmax).toBeLessThanOrEqual(20.1)
  })
})
