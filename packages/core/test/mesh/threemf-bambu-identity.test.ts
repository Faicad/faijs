/**
 * mesh/threemf-bambu-identity.test.ts — P4：Bambu 3MF 两套编号关联。
 *
 * vise.3mf（真实 Bambu 工程）里 3MF `<object id>`（叶子实例，含子文件内
 * 局部 id）与 model_settings.config 的 `<object id>`（父对象）是两套编号；
 * `<build>` 位于 `<resources>` 之前。本测试锁定：
 * 1. `parseThreemf` 返回全量 build（不再因 tail 切片漏掉 build items）。
 * 2. 叶子 `parentObjectId/componentIndex` 与 `bambu.leafParts`（build items ×
 *    父对象 components 展开的打印单元表）一一命中 → importModel.parts 携带
 *    Bambu 身份（objectId/partId/plateId/extruder）。
 * 3. 多 part 父对象（objectId 19 → partId 17/18）按 components 序正确展开。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseThreemf } from '../../src/mesh/threemf-loader'
import { parseBambu3mfFromArchive } from '../../src/mesh/threemf-bambu'
import { importFile } from '../../src/mesh/io'

const visePath = fileURLToPath(new URL('../../../fixtures/data/vise.3mf', import.meta.url))

function readVise(): ArrayBuffer {
  const data = readFileSync(visePath)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

describe('P4 — Bambu 3MF 两套编号关联（vise.3mf）', () => {
  it('parseThreemf：build items 全量解析（build 在 resources 前）+ 叶子带父 id', async () => {
    const archive = await parseThreemf(readVise())
    expect(archive.objects.length).toBe(21)
    // 叶子实例带 Bambu 父对象身份（build item id）
    const leaf0 = archive.objects[0]
    expect(leaf0.parentObjectId).toBe(2)
    expect(leaf0.componentIndex).toBe(1)
    // `<build>` 在 resources 之前：modelXml 必须完整携带 build items
    expect(archive.modelXml).toBeTruthy()
    expect(archive.modelXml!.includes('<build')).toBe(true)
  })

  it('parseBambu3mfFromArchive：buildItems 19 个、打印单元表 21 个、leafParts 21 项', async () => {
    const archive = await parseThreemf(readVise())
    const bambu = parseBambu3mfFromArchive(archive)
    expect(bambu.buildItems?.length).toBe(19)
    expect(bambu.parts.length).toBe(21)
    expect(bambu.leafParts.size).toBe(21)
    expect(bambu.plates.size).toBe(2)
    // 每个叶子都能在 leafParts 命中（键 = 父id:componentIndex）
    for (const obj of archive.objects) {
      const key = `${obj.parentObjectId}:${obj.componentIndex ?? 1}`
      expect(bambu.leafParts.has(key)).toBe(true)
    }
  })

  it('importFile：importModel.parts 携带 Bambu 身份（父 components 关联）', async () => {
    const { importModel } = await importFile(readVise(), '3mf')
    expect(importModel).toBeTruthy()
    const parts = importModel!.parts
    expect(parts.length).toBe(21)
    // 首零件：父对象 2 → screw holder（Bambu part id 1、盘 1、挤出机 4）
    expect(parts[0]).toMatchObject({
      objectId: '2',
      partId: '1',
      plateId: 1,
      extruder: 4,
    })
    // 多 part 父对象 19（vise body）：components 序 → partId 17/18
    const body = parts.filter((p) => p.objectId === '19')
    expect(body.map((p) => p.partId)).toEqual(['17', '18'])
    // 盘号分组：plate 1 = 螺丝/夹具（extruder 4）、plate 2 = 本体/滑块
    expect(parts.filter((p) => p.plateId === 1).length).toBeGreaterThan(0)
    expect(parts.filter((p) => p.plateId === 2).length).toBeGreaterThan(0)
    // 视图数据齐全：assemble 19 / importTransforms 21（普通对象）
    expect(importModel!.bambuViews).toBeTruthy()
    expect(Object.keys(importModel!.bambuViews!.assembleTransforms ?? {}).length).toBe(19)
    expect(Object.keys(importModel!.bambuViews!.importTransforms ?? {}).length).toBe(21)
    expect(importModel!.bambuViews!.buildItems?.length).toBe(19)
  })
})
