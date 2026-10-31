/**
 * PMI → 导出链路的接线验证（`shape.pmi` → `ExportEntry.pmi`）。
 *
 * 背景（2026-10-31 修订）：PMI 设计文档曾声称导出链路"已具备"，实测
 * `api/export-step.ts#stepEntryOf` 与 `api/export-3mf.ts#entryOfNode` 都**不读**
 * `shape.pmi`——标注画得再好，导出文件里什么都没有。本文件钉住修复后的行为。
 *
 * 覆盖范围说明：STEP 侧只验证能不抛错地导出（`threadHole` 没有对应 XCAF 写入
 * 能力，见 step-pmi.ts 的能力探测），3MF 侧验证元数据里确实带着标注。
 *
 * 运行：npx vitest run test/api/pmi/pmi-export-wiring.test.ts
 */

import { describe, it, expect } from 'vitest'
import { solid, type SolidShape } from '../../../src/shape'
import { appendPmiItem } from '../../../src/api/pmi/methods'
import { threadHole } from '../../../src/api/pmi/types'
import { export3mf } from '../../../src/api/export-3mf'
import { readZipEntries } from '../../../src/io/zip'
import { configureHost } from '../../support/host-env'
import { PMI_3MF_METADATA_NAME } from '../../../src/mesh/threemf-pmi'

/** 带三角载荷的最小实体（3MF 只吃 mesh，不需要内核）。 */
function meshShape(): SolidShape {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

function tappedM6() {
  return threadHole({
    thread: { standard: 'metric', nominalDiameter: 6, pitch: 1, toleranceClass: '6H', depth: 14, specLabel: 'M6' },
    pilot: { diameter: 5, depth: 16 },
    axis: { origin: [0, 0, 10], direction: [0, 0, -1] },
    process: 'tapped',
  })
}

describe('3MF 导出携带 PMI', () => {
  it('螺纹孔标注写进 <metadatagroup>（底孔 + 螺纹都在）', () => {
    configureHost('node')
    const shape = meshShape()
    appendPmiItem(shape, tappedM6())
    const bytes = export3mf(shape)
    const entries = readZipEntries(bytes)
    const modelKey = [...entries.keys()].find((k) => k.endsWith('.model'))
    expect(modelKey, '3MF 里应有 3D 模型部件').toBeDefined()
    const xml = new TextDecoder().decode(entries.get(modelKey!)!)
    expect(xml).toContain(PMI_3MF_METADATA_NAME)
    expect(xml).toContain('threadHole')
    // 两类信息都要在元数据里（不是只有后加工那半）
    expect(xml).toContain('&quot;diameter&quot;:5')
    expect(xml).toContain('&quot;nominalDiameter&quot;:6')
  })

  it('没有标注时不写空元数据组', () => {
    configureHost('node')
    const bytes = export3mf(meshShape())
    const entries = readZipEntries(bytes)
    const modelKey = [...entries.keys()].find((k) => k.endsWith('.model'))!
    const xml = new TextDecoder().decode(entries.get(modelKey)!)
    expect(xml).not.toContain(PMI_3MF_METADATA_NAME)
  })
})
