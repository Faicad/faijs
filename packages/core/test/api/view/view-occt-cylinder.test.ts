/**
 * view-occt-cylinder — 圆柱投影在 occt 引擎下的行为留档（2026-10-14 调研）。
 *
 * 背景：3d_editor 工程图工作台在 brepkit 下发现两个问题——
 *   ① 无竖直母线（brepkit 内核 projectEdges 不输出曲面 silhouette，见
 *      view-brepkit-cylinder.test.ts 的 GOTCHA）；
 *   ② iso 顶部 visible / 底部 hidden 的 y 向上坐标（绘制端曾未翻转）。
 * 本测试钉住 occt（compound HLR 通道）的对应行为：
 *   - **occt 有母线**：front/right/iso 的 visible 组含两条竖直母线
 *     （x=±10，覆盖 y∈[-15,15]）——母线缺失是 brepkit 内核专属限制，
 *     不是 faijs 层通用问题；
 *   - **y 向上契约与 brepkit 同构**：iso 顶部（y 大处）visible、底部
 *     （y 小处）hidden——3d_editor 的 flipY（默认 true）对两引擎均成立。
 *
 * Run: npx vitest run test/api/view/view-occt-cylinder.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { projectViewSvg } from '../../../src/api/view/view-projection'
import type { Shape } from '../../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 解析 path d 串为点对数组。 */
function pointsOf(d: string): Array<[number, number]> {
  const nums = d.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)!.map(Number)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!])
  return out
}

/**
 * 竖直母线判定（相对高度）：x 近乎恒定（跨度 < 0.5）+ y 跨度 ≥ 内容总高的 60%。
 * 不硬编码 ±15 全高——iso 视图下母线投影高度被压缩（≈±12.25），front/right 才是 ±15。
 */
function verticalSilhouettes(visible: string[]): string[] {
  const allYs = visible.flatMap((d) => pointsOf(d).map(([, y]) => y))
  if (allYs.length === 0) return []
  const span = Math.max(...allYs) - Math.min(...allYs)
  return visible.filter((d) => {
    const pts = pointsOf(d)
    if (pts.length < 2) return false
    const xs = pts.map(([x]) => x)
    const ys = pts.map(([, y]) => y)
    const xSpread = Math.max(...xs) - Math.min(...xs)
    return xSpread < 0.5 && Math.max(...ys) - Math.min(...ys) >= span * 0.6
  })
}

describe('occt × 圆柱投影（母线存在 + y 向上契约留档）', () => {
  let rt: CadRuntime
  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespaceWithEditorOps() })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  async function cylinderShape(): Promise<Shape> {
    const res = await rt.execute('let p0 = cad.cylinder(10, 30, { centered: true })')
    expect(res.failedAt?.message ?? 'no failure').toBe('no failure')
    const s = res.outputs.get('p0' as never) as Shape
    expect(s).toBeDefined()
    return s
  }

  it('front/right/iso 均含两条竖直母线（occt outline 通道输出 silhouette）', async () => {
    const s = await cylinderShape()
    for (const view of ['front', 'right', 'iso'] as const) {
      const r = projectViewSvg(s, view)
      const silhouettes = verticalSilhouettes(r.paths.visible)
      expect(silhouettes.length).toBe(2)
    }
  })

  it('iso 顶部（y 大处）visible、hidden 全在下半区 —— y 向上与 brepkit 同构', async () => {
    const s = await cylinderShape()
    const iso = projectViewSvg(s, 'iso')
    // y 向上契约：顶圆在 y 大处且归 visible；hidden（底面遮挡段）全部在 y 小处。
    // （occt 的底面圆部分可见——iso 下底圆前弧可见，后弧隐藏，故不要求区间不重叠。）
    const ysVisible = iso.paths.visible.flatMap((d) => pointsOf(d).map(([, y]) => y))
    const ysHidden = iso.paths.hidden.flatMap((d) => pointsOf(d).map(([, y]) => y))
    expect(Math.max(...ysVisible)).toBeGreaterThanOrEqual(17) // 顶圆顶部可见
    expect(Math.max(...ysHidden)).toBeLessThan(0) // 隐藏全部在 y<0（下半区）
  })
})
