/**
 * compare-poses — P0/P3 基线比对：faijs 当前导出（chain 求解）vs CadQuery 2.8.0 参考。
 *
 * 读取 out/mini_lathe.step（faijs 导出，transform 已烘焙进几何、leaf.transform=NULL）
 * 与 out/ref/mini_lathe.step（CQ 参考导出），对每个同名成员比较其世界包围盒最小点
 * (xmin,ymin,zmin) 之差。
 *
 * 方法说明：部件局部几何在两个 STEP 中相同，故
 *   world_bbox_min = world_translation + local_bbox_min（无旋转时）；
 * 两 STEP 的 world_bbox_min 之差即 world_translation 之差，local_bbox_min 被抵消，
 * 因此该差值精确反映"堆叠平移错位"（旋转时也会体现在 x/y 分量上）。
 *
 * 用法：node_modules/.bin/tsx packages/mini_lathe/scripts/compare-poses.ts
 * 产物：out/ref/pose-diff.json（逐成员 bbox_min 差 + 最大偏差）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initOcctWasm, importAssemblyFromStep, collectLeafParts } from '@faicad/faijs-core'

const ROOT = import.meta.dirname
const OUT = join(ROOT, '..', 'out')
const REF = join(ROOT, '..', 'out', 'ref')

type BBox = { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }

async function leafBBoxes(buf: Buffer, kernel: any): Promise<Map<string, BBox>> {
  const nodes = await importAssemblyFromStep(buf.buffer as ArrayBuffer)
  const leaves = collectLeafParts(nodes).filter((n: any) => n.shapeHandle !== null)
  const m = new Map<string, BBox>()
  for (const l of leaves) {
    m.set(l.name, kernel.getBoundingBox(l.shapeHandle as never))
  }
  return m
}

async function main() {
  const kernel = await initOcctWasm()

  const faijs = await leafBBoxes(readFileSync(join(OUT, 'mini_lathe.step')), kernel)
  const cq = await leafBBoxes(readFileSync(join(REF, 'mini_lathe.step')), kernel)

  console.log('=== faijs chain vs CQ 2.8.0 reference (world bbox_min diff, mm) ===')
  const diffs: Array<{
    name: string
    faijsMin: [number, number, number]
    cqMin: [number, number, number]
    diff: [number, number, number]
    mag: number
  }> = []
  const missing: string[] = []

  for (const [name, fb] of faijs) {
    const cb = cq.get(name)
    if (!cb) {
      missing.push(name)
      continue
    }
    const d: [number, number, number] = [fb.xmin - cb.xmin, fb.ymin - cb.ymin, fb.zmin - cb.zmin]
    const mag = Math.hypot(d[0], d[1], d[2])
    diffs.push({
      name,
      faijsMin: [fb.xmin, fb.ymin, fb.zmin],
      cqMin: [cb.xmin, cb.ymin, cb.zmin],
      diff: d,
      mag,
    })
    console.log(
      `  ${name.padEnd(10)} diff=(${d.map((x) => x.toFixed(3)).join(', ')})  |d|=${mag.toFixed(3)}`,
    )
  }
  if (missing.length) console.log('  (missing in CQ ref: ' + missing.join(', ') + ')')

  const maxMag = diffs.length ? Math.max(...diffs.map((d) => d.mag)) : 0
  console.log(`  MAX |diff| = ${maxMag.toFixed(3)} mm`)

  writeFileSync(
    join(REF, 'pose-diff.json'),
    JSON.stringify({ schema: 'pose-diff-v1', maxMag, diffs, missing }, null, 2),
  )
  console.log('  -> out/ref/pose-diff.json')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
