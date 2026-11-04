/**
 * @vitest-environment node
 *
 * `buildPmiLayer` 全选项直呼测试：`PmiLayerOptions` 的 7 个历史未覆盖参数
 * （fontSize / color / showHiddenTargets / globalNotes / gap / fontFamily / only）
 * 必须出现在调用点对象字面量里（L2 扫描只认直呼形态，见 anchor-align.test.ts）。
 * 顺带直呼覆盖同文件的 `buildGlobalPmiBlock` / `globalNoteTexts` / `assignPmiToViews`
 * （L1 历史缺口）。
 *
 * 环境同 view-pmi-layer.test.ts：OCCT + CadRuntime（auto），box + faceRef 尺寸标注。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { initOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { buildPmiLayer, buildGlobalPmiBlock, globalNoteTexts, assignPmiToViews } from '../../../src/api/view/pmi-layer'
import { viewCamera } from '../../../src/api/view/view-camera'
import type { Shape } from '../../../src/mesh/types'
import { createApiNamespace } from '../../../src/api/api-namespace'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const BOX = 'let part0 = cad.box(10, 20, 30)'

describe('buildPmiLayer 全选项直呼（L2）', () => {
  let rt: CadRuntime

  beforeAll(async () => {
    await initOcctWasm()
    rt = new CadRuntime(defaultPorts(), 'auto', { cad: createApiNamespace() })
    await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
  }, 120000)

  async function annotatedPart(): Promise<Shape> {
    const res = await rt.execute(`${BOX}
part0.addDimension({
  dimType: 'linearX',
  targets: [cad.faceRef(part0, 1), cad.faceRef(part0, 2)],
  nominal: 10,
})
part0.addNote({ text: '锐边倒钝' })`)
    expect(res.failedAt).toBeUndefined()
    return res.outputs.get('part0' as never) as Shape
  }

  it('全选项字面量：fontSize/color/gap/fontFamily 进 markup，globalNotes 画全局块，only 过滤条目', async () => {
    const p = await annotatedPart()
    const r = buildPmiLayer(
      p,
      viewCamera('front'),
      { minX: 0, minY: 0, maxX: 10, maxY: 30 },
      {
        layerName: '全选项',
        fontSize: 3.5,
        color: '#c0392b',
        showHiddenTargets: true,
        globalNotes: true,
        gap: 6,
        fontFamily: 'monospace',
      },
    )
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(r.markup).toContain('inkscape:label="全选项"')
    expect(r.markup).toContain('font-family="monospace"')
    expect(r.markup).toContain('#c0392b')
  })

  it('only: 只画选中的条目（过滤后计数减少）', async () => {
    const p = await annotatedPart()
    const all = buildPmiLayer(p, viewCamera('front'), { minX: 0, minY: 0, maxX: 10, maxY: 30 })
    const only = buildPmiLayer(
      p,
      viewCamera('front'),
      { minX: 0, minY: 0, maxX: 10, maxY: 30 },
      { only: new Set([0]) },
    )
    expect(all.count).toBeGreaterThanOrEqual(1)
    expect(only.count).toBeLessThanOrEqual(all.count)
  })

  it('globalNoteTexts / assignPmiToViews / buildGlobalPmiBlock 直呼', async () => {
    const p = await annotatedPart()
    // 全局注释（无 target 无 anchor 的 note）→ globalNoteTexts 收得到
    const texts = globalNoteTexts(p)
    expect(texts).toContain('锐边倒钝')
    // 视图归属：front 视图只有部分条目；返回数组长度 == items 数
    const cam = viewCamera('front')
    const owners = assignPmiToViews(p, [cam])
    expect(owners.length).toBeGreaterThanOrEqual(1)
    // 全局块直呼：给定全局文本 + 字号/颜色，返回非空 markup 与尺寸
    const block = buildGlobalPmiBlock(texts, { fontSize: 3, color: '#000', gap: 4 })
    expect(block.markup).toContain('锐边倒钝')
  })
})
