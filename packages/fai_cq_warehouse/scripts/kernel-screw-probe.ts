/**
 * kernel-screw-probe.ts — W5（Screw 12 类）容差标定的可复跑测量台。
 *
 * 用途（方案 §7.3.1 四步走的第 1 步「实测最坏值」）：螺钉族唯一越界用例
 * `screw-shcs-m6-iso4762-threaded`（`simple=false` → 真实螺旋外螺纹 + 圆柱头）
 * 在 STEP 比对里报 `vol 4.149e-2%`、`com 5.472e-2 mm`，而 bbox 差 0。
 * 本脚本用**同一 occt-wasm 内核**导入两侧 STEP，把 GProps 与**三角化**两组量
 * 并列打印，判定「差在几何」还是「差在 GProps 对螺旋 B 样条面的求积混叠」。
 *
 * 运行：npx tsx scripts/kernel-screw-probe.ts
 * 结论载体（回归锁）：
 *   - 容差定义 src/testing/compare.ts（`screw-shcs-m6-iso4762-threaded` override）
 *   - 反向守卫 src/screw.test.ts（用旧容差必须 DIFFERENT）
 *   - 分析文档 docs/analysis/2026-09-14-cq-warehouse-screw-probe.md
 *
 * ⚠️ 本脚本只**打印**、不 assert —— 它是证据生成器；断言在测试里。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel, type WarehouseKernel } from '../src/kernel'
import {
  MESH_ANGULAR_DEFLECTION,
  MESH_LINEAR_DEFLECTION,
  volumeOf,
} from '../src/primitives'
import { buildScrew } from '../src/screw'

let k: WarehouseKernel

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(52)} ${String(value)}`)
}

/** 三角化体积 + 质心（散度定理逐三角形累加）。 */
function meshVolumeCom(
  h: BrepHandle,
  linearDeflection = MESH_LINEAR_DEFLECTION,
): { v: number; c: [number, number, number] } {
  const mesh = k.tessellate(h, {
    linearDeflection,
    angularDeflection: MESH_ANGULAR_DEFLECTION,
  })
  const p = mesh.positions
  const idx = mesh.indices
  let v = 0
  let cx = 0
  let cy = 0
  let cz = 0
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const ax = p[idx[t]! * 3]!
    const ay = p[idx[t]! * 3 + 1]!
    const az = p[idx[t]! * 3 + 2]!
    const bx = p[idx[t + 1]! * 3]!
    const by = p[idx[t + 1]! * 3 + 1]!
    const bz = p[idx[t + 1]! * 3 + 2]!
    const gx = p[idx[t + 2]! * 3]!
    const gy = p[idx[t + 2]! * 3 + 1]!
    const gz = p[idx[t + 2]! * 3 + 2]!
    const vt = (ax * (by * gz - bz * gy) - ay * (bx * gz - bz * gx) + az * (bx * gy - by * gx)) / 6
    v += vt
    cx += (vt * (ax + bx + gx)) / 4
    cy += (vt * (ay + by + gy)) / 4
    cz += (vt * (az + bz + gz)) / 4
  }
  return { v, c: [cx / v, cy / v, cz / v] }
}

const comDelta = (a: [number, number, number], b: [number, number, number]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

/** (a) 参考 STEP 导入 A 侧，(b) 本包构造 B 侧，两侧同内核并列测量。 */
function bothSides(id: string, buildB: () => BrepHandle): { a: BrepHandle; b: BrepHandle } {
  const dir = mkdtempSync(join(tmpdir(), 'w5-probe-'))
  const aPath = join(dir, 'a.step')
  const bPath = join(dir, 'b.step')
  const ref = fileURLToPath(new URL(`../fixtures/reference/${id}.step`, import.meta.url))
  writeFileSync(aPath, readFileSync(ref))
  writeFileSync(bPath, Buffer.from(exportStepFromSolids(k, [{ solid: buildB(), name: 'SOLID' }])))
  const buf = (p: string): ArrayBuffer => {
    const x = readFileSync(p)
    return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer
  }
  return { a: k.importStep(buf(aPath)), b: k.importStep(buf(bPath)) }
}

const SECTIONS: Record<string, () => void> = {
  // ── 1：simple=false 的螺旋外螺纹 —— GProps 混叠的三角化裁定 ──
  '1': () => {
    console.log('── 1: screw-shcs-m6-iso4762-threaded（simple=false）──')
    const id = 'screw-shcs-m6-iso4762-threaded'
    const { a, b } = bothSides(id, () => {
      const r = buildScrew('SocketHeadCapScrew', {
        size: 'M6-1',
        length: 25,
        fastener_type: 'iso4762',
        simple: false,
      })
      if (!r.handle) throw new Error('SocketHeadCapScrew: 无几何')
      return r.handle
    })

    const gA = volumeOf(a)
    const gB = volumeOf(b)
    const mA = meshVolumeCom(a)
    const mB = meshVolumeCom(b)
    const gcA = k.getCenterOfMass(a)
    const gcB = k.getCenterOfMass(b)
    const gcArr = (v: { x: number; y: number; z: number }): [number, number, number] => [v.x, v.y, v.z]

    line('GProps 体积 A / B', `${gA.toFixed(6)} / ${gB.toFixed(6)}`)
    line('GProps 体积相对差', (Math.abs(gA - gB) / gA).toExponential(3))
    line('GProps 质心 A', gcArr(gcA).map((v) => v.toFixed(6)).join(', '))
    line('GProps 质心 B', gcArr(gcB).map((v) => v.toFixed(6)).join(', '))
    line('GProps 质心差（判据 com）(mm)', comDelta(gcArr(gcA), gcArr(gcB)).toExponential(3))
    line('三角化体积 A / B', `${mA.v.toFixed(6)} / ${mB.v.toFixed(6)}`)
    line('三角化体积相对差', (Math.abs(mA.v - mB.v) / mA.v).toExponential(3))
    line('三角化质心最大差 (mm)', comDelta(mA.c, mB.c).toExponential(3))
    // 自偏差 = 同一侧「GProps 质心」与「三角化质心」之差 —— 若两侧都大，说明
    // GProps 的一阶矩对该螺旋面不可信（一阶矩对求积混叠比体积敏感得多）。
    line('GProps 质心自偏差 A (mm)', comDelta(gcArr(gcA), mA.c).toExponential(3))
    line('GProps 质心自偏差 B (mm)', comDelta(gcArr(gcB), mB.c).toExponential(3))
    line('GProps 体积自偏差 A / B', `${(Math.abs(gA - mA.v) / gA).toExponential(3)} / ${(Math.abs(gB - mB.v) / gB).toExponential(3)}`)
    line('三角化质心 A', mA.c.map((v) => v.toFixed(6)).join(', '))
    line('三角化质心 B', mB.c.map((v) => v.toFixed(6)).join(', '))
  },

  // ── 2：同族但 simple=true（光杆）—— 证明差异只在螺纹面 ──
  '2': () => {
    console.log('── 2: 对照 screw-shcs-m6-iso4762（simple=true，光杆）──')
    const id = 'screw-shcs-m6-iso4762'
    const { a, b } = bothSides(id, () => {
      const r = buildScrew('SocketHeadCapScrew', {
        size: 'M6-1',
        length: 25,
        fastener_type: 'iso4762',
      })
      if (!r.handle) throw new Error('SocketHeadCapScrew: 无几何')
      return r.handle
    })
    const gA = volumeOf(a)
    const gB = volumeOf(b)
    const mA = meshVolumeCom(a)
    const mB = meshVolumeCom(b)
    line('GProps 体积相对差', (Math.abs(gA - gB) / gA).toExponential(3))
    line('三角化体积相对差', (Math.abs(mA.v - mB.v) / mA.v).toExponential(3))
    line('三角化质心最大差 (mm)', comDelta(mA.c, mB.c).toExponential(3))
  },

  // ── 3：网格收敛扫描 —— 区分「网格伪差」与「真实面差」 ──
  // 若两侧差随弦高收紧而收敛到同一极限，则差在**网格**；若差与弦高无关而固化，
  // 则差在**曲面表示**（A 侧裁剪螺旋面 vs 我方 loft(ruled) 逼近）——后者才是
  // 上游方法差异，才允许按类 override（§7.3.1）。
  '3': () => {
    console.log('── 3: threaded 例的网格收敛（弦高 2e-3 / 8e-4）──')
    const id = 'screw-shcs-m6-iso4762-threaded'
    const { a, b } = bothSides(id, () => {
      const r = buildScrew('SocketHeadCapScrew', {
        size: 'M6-1',
        length: 25,
        fastener_type: 'iso4762',
        simple: false,
      })
      if (!r.handle) throw new Error('SocketHeadCapScrew: 无几何')
      return r.handle
    })
    for (const defl of [2e-3, 8e-4]) {
      const ma = meshVolumeCom(a, defl)
      const mb = meshVolumeCom(b, defl)
      line(
        `弦高 ${defl}：三角化体积相对差`,
        `${(Math.abs(ma.v - mb.v) / ma.v).toExponential(3)}（A ${ma.v.toFixed(4)} / B ${mb.v.toFixed(4)}）`,
      )
      line(`弦高 ${defl}：三角化质心最大差 (mm)`, comDelta(ma.c, mb.c).toExponential(3))
    }
  },
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2)
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  for (const key of wanted.length ? wanted : Object.keys(SECTIONS)) {
    const fn = SECTIONS[key]
    if (!fn) {
      console.log(`(unknown section ${key})`)
      continue
    }
    fn()
    console.log('')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
