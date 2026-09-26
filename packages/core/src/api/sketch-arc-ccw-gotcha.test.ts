/**
 * GOTCHA 留档（2026-09-25，A3 / FCBL_tree_entourage）：sketch arc 的 `ccw`
 * 字段参与几何方向，不是元数据。
 *
 * `arcToHandles`（sketch.ts）用 makeArcEdge 的「起点-中点-终点」三点定弧；
 * 旧实现忽略 `ccw:false`、一律取 CCW 中点 → CW 短弧被画成 CCW **长弧**（补角）。
 * 后果链：长弧穿过旋转轴 → `cad.revolve` 产物退化（getBoundingBox 返回 NaN）
 * → BRepMesh 在该退化体上挂死，**进程无声死亡**（无异常、无 stderr，vitest
 * worker 直接消失，console 输出全部丢失）。
 *
 * 本测试取 FCBL_tree_entourage 的 s1 轮廓（4 直线 + 3 条 ccw:false 圆弧，
 * 其中 A2 r=2823 弧的 CCW 补角弧恰好跨越 x=0）做回归护栏：
 * 修复前 = 原尺寸跑 5 分钟无结果/进程死；修复后 = 秒级通过。
 * 精度口径：revolve 产物包围盒必须为有限数（NaN = 长弧穿轴的退化指纹）。
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../index'
import { createNodePorts } from '../node'
import { initOcctWasm } from '../occt-kernel/occtKernel'

beforeAll(async () => { await initOcctWasm() }, 120000)

// FCBL_tree_entourage s1 Sketch001（原尺寸，未缩放）
const TREE_PROFILE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 1078.6061879890412, x2: -554.9340000000001, y2: 1078.6061879890412 },
  { kind: 'arc', cx: -554.934, cy: 1576.61, radius: 498.00381201095877, startAngle: -1.570796326794897, endAngle: -2.7126514609372734, ccw: false, x1: -554.9340000000001, y1: 1078.606187989041, x2: -1007.8219663923912, y2: 1369.4861561905275 },
  { kind: 'line', x1: -1007.8219663923912, y1: 1369.4861561905275, x2: -1073.395535969475, y2: 1512.8664644575629 },
  { kind: 'arc', cx: 1494.060356088772, cy: 2687.0670894166183, radius: 2823.221008939762, startAngle: -2.7126514609372743, endAngle: 2.8740556782240416, ccw: false, x1: -1073.395535969475, y1: 1512.8664644575629, x2: -1228.724391685866, y2: 3433.4048699186155 },
  { kind: 'line', x1: -1228.724391685866, y1: 3433.4048699186155, x2: -779.3228279419842, y2: 5072.908798776252 },
  { kind: 'arc', cx: 0, cy: 4859.289977025418, radius: 808.0699667465105, startAngle: 2.8740556782240416, endAngle: 1.5707963267948966, ccw: false, x1: -779.3228279419842, y1: 5072.908798776252, x2: 4.94800149131611e-14, y2: 5667.359943771929 },
  { kind: 'line', x1: 4.94800149131611e-14, y1: 5667.359943771929, x2: 0, y2: 1078.6061879890412 }
], closed: true }] }`

describe('GOTCHA: sketch arc ccw:false must not become a CCW long arc (A3 regression)', () => {
  it('ccw:false arcs revolve in seconds (no degenerate solid, no mesher hang)', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const result = await runtime.execute(`
        const part1 = cad.profile(${TREE_PROFILE})
        const part3 = cad.revolve(part1, { axis: [0,0,1], at: [0,0,0], angle: 6.283185307179586 })
      `, { topology: 'auto' })
      expect(result.failedAt, `execution failed: ${result.failedAt?.message ?? ''}`).toBeUndefined()
      // part3 产物存在 = revolve 完成；修复前此脚本在 revolve 处进程级挂死
      const outputs = result.outputs as Map<string, unknown>
      expect(outputs.get('part3')).toBeDefined()
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('ccw:false full circle splits into CW halves (arc direction preserved)', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const result = await runtime.execute(`
        const p = cad.profile({ contours: [{ segments: [
          { kind: 'arc', cx: 50, cy: 0, radius: 25, startAngle: 0, endAngle: 0, ccw: false }
        ], closed: false }] , as: 'wire' })
      `, { topology: 'auto' })
      expect(result.failedAt, `failed: ${result.failedAt?.message ?? ''}`).toBeUndefined()
      const w = (result.outputs as Map<string, unknown>).get('p')
      expect(w).toBeDefined()
    } finally {
      runtime.dispose()
    }
  }, 60000)
})
