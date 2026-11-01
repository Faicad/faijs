/**
 * smlib-kernel/smlib-wire-and-loft — `cad.wire` 造线 / 面→外环 wire / loft 三处缺口回归
 *
 * 三件事在 2026-10-31 之前全部失败，且都不是"装载没报错"级别的失败，而是端侧稳定红：
 *
 * ① **`cad.wire` 三点折线 → `bad edge id <id>`**
 *    根因：smlib **没有独立 Edge 实体**。`makeLineEdge` / `makeArcEdge` /
 *    `makeBezierEdge` 返回的是 **curve** 句柄（`smw_make_line_segment` 直接产出 Curve
 *    slot），而 `makeWire` 无条件对每个元素调 `k.edgeToCurve`。把 curve id 当 edge
 *    解引用 → 内核 `smw_curve_type failed: bad edge id 460`（worker-sim 草图四操作实测
 *    的真实 id）。修法：`makeWire` 按 kind 分派，Curve 直收、Edge 才 edgeToCurve。
 *    GOTCHA：**不要**假设 `BrepEngineApi.makeLineEdge` 返回的一定是 edge —— 在 smlib
 *    这条链上它是 curve。任何"先拿 edge 再 edgeToCurve"的写法都必须先判 kind。
 *
 * ② **`getSubShapes(face, 'wire')` → `not implemented in P1`**
 *    根因：wire 在 smlib 里只有合成句柄（`WIRE_TAG`），且只在 `makeWire` 时登记；
 *    face 的边界环从来没被适配成 wire。而 `api/internal/profile-wire.ts` 的「面 → 外环」
 *    正是 loft / sweep 的截面适配唯一入口，于是 loft 在端侧必然失败。
 *    修法：face → `k.faceLoops` → 每个 loop 一条合成 wire，**索引 0 = 外环**
 *    （SMLib 契约：`GetUpwardLoopuses` 首个 loop 即 OuterLoop，见
 *     `usd-brep/source/SM_API/src/SmApiQueries.cpp:324`）。
 *
 * ③ **`getSubShapes(face, 'face')` → `not implemented in P1`**
 *    OCCT 语义：`TopExp_Explorer(face, TopAbs_FACE)` 的首项是自身。选择器 / 面查询
 *    在 face 句柄上继续求 face 是合法调用，必须返回 `[face]`。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-wire-and-loft.test.ts
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { createSmlibPrimitives, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { createEditorRuntime } from '../support/editor-ops'

/** worker-sim 草图四操作里逐字发出的路径形态：3 点 → 2 段折线。 */
const WIRE_POINTS: Array<[number, number, number]> = [
  [0, 0, 0],
  [0, 0, 25],
  [0, 0, 50],
]
const WIRE_SCRIPT = `let w0 = cad.wire([${WIRE_POINTS.map((p) => `[${p[0]} * MM, ${p[1]} * MM, ${p[2]} * MM]`).join(', ')}])`

/** 方框截面（2D 面）：走「面 → 外环」适配路径，loft 的典型输入。 */
function squareProfile(half: number): string {
  return (
    'cad.profile({ contours: [{ segments: [ ' +
    `{ kind: "line", x1: ${-half}, y1: ${-half}, x2: ${half}, y2: ${-half} }, ` +
    `{ kind: "line", x1: ${half}, y1: ${-half}, x2: ${half}, y2: ${half} }, ` +
    `{ kind: "line", x1: ${half}, y1: ${half}, x2: ${-half}, y2: ${half} }, ` +
    `{ kind: "line", x1: ${-half}, y1: ${half}, x2: ${-half}, y2: ${-half} } ] }] })`
  )
}

const LOFT_SCRIPT = `let p0 = ${squareProfile(5)}
let p1 = cad.translate(p0, [0 * MM, 0 * MM, 20 * MM])
let p2 = cad.loft([p0, p1])
`

function ports(): { events: { emit: () => undefined } } {
  return { events: { emit: () => undefined } }
}

describe('smlib wire / 面→外环 / loft 缺口回归', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('cad.wire 三点折线可执行（makeWire 接受 curve 句柄，不再报 bad edge id）', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime(ports(), 'brep')
    const result: ExecutionResult = await runtime.execute(WIRE_SCRIPT)
    expect(result.failedAt).toBeUndefined()
  })

  it('面截面 loft 可执行且几何落在两截面之间（面→外环 wire 生效）', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime(ports(), 'brep')
    const result: ExecutionResult = await runtime.execute(LOFT_SCRIPT)
    expect(result.failedAt).toBeUndefined()
    const lofted = result.outputs.get(asPartName('p2')) as { positions?: Float32Array } | undefined
    expect(lofted).toBeDefined()
    const pos = lofted!.positions!
    expect(pos.length).toBeGreaterThan(0)
    // 只判 z 跨度：截面 10×10 在 z=0 与 z=20，蒙皮体必须够到 20 附近。
    let zMin = Infinity
    let zMax = -Infinity
    for (let i = 2; i < pos.length; i += 3) {
      if (pos[i]! < zMin) zMin = pos[i]!
      if (pos[i]! > zMax) zMax = pos[i]!
    }
    expect(zMax).toBeGreaterThanOrEqual(19.5)
    expect(zMin).toBeLessThanOrEqual(0.5)
  })

  describe('内核级：子形状查询语义', () => {
    let p: SmlibPrimitives
    beforeAll(async () => {
      p = await createSmlibPrimitives()
    })

    it('makeWire 收 curve：3 点折线 → wire 的 edge 数 = 段数', () => {
      const edges = WIRE_POINTS.slice(0, -1).map((a, i) =>
        p.makeLineEdge(
          { x: a[0], y: a[1], z: a[2] },
          { x: WIRE_POINTS[i + 1]![0], y: WIRE_POINTS[i + 1]![1], z: WIRE_POINTS[i + 1]![2] },
        ),
      )
      const wire = p.makeWire(edges)
      expect(p.getSubShapes(wire, 'edge').length).toBe(WIRE_POINTS.length - 1)
    })

    it('getSubShapes(face,"wire") 返回边界环，索引 0 为外环（4 边）', () => {
      const solid = p.makeBox(10, 10, 10)
      const faces = p.getSubShapes(solid, 'face')
      expect(faces.length).toBe(6)
      const wires = p.getSubShapes(faces[0]!, 'wire')
      expect(wires.length).toBe(1)
      expect(p.getSubShapes(wires[0]!, 'edge').length).toBe(4)
    })

    it('getSubShapes(face,"face") 返回自身（OCCT TopExp 语义）', () => {
      const solid = p.makeBox(10, 10, 10)
      const face = p.getSubShapes(solid, 'face')[0]!
      const faces = p.getSubShapes(face, 'face')
      expect(faces.length).toBe(1)
      expect(faces[0]).toBe(face)
    })

    it('同一 face 重复取 wire 命中缓存（句柄稳定，不重复合成）', () => {
      const solid = p.makeBox(10, 10, 10)
      const face = p.getSubShapes(solid, 'face')[0]!
      const a = p.getSubShapes(face, 'wire')
      const b = p.getSubShapes(face, 'wire')
      expect(b[0]).toBe(a[0])
    })
  })
})
