/**
 * probe-spokes.ts — 隔离 case04/case06（n=3）轮辐体积误差来源
 *
 * 每阶段独立完整构建（与 buildGearSolid 测试路径一致），对比：
 *   chamfer+bore → +recess → +hub → +spokes(无 fillet) → +spokes(fillet)
 * 与 cq 参考（manifest volume）对照，定位误差来自 spokes 还是 fillet。
 */
import { getGearKernel, type GearKernel } from '@faicad/cq-compat'
import { buildSpurGearSolid } from '../src/spur_gear'
import { applyRecess, applyHub, applySpokes, type GearFeatureOptions } from '../src/features'
import { spurGearGeometry } from '../src/profile'
import { loadManifest } from '../src/fixtures'

function stageVol(kernel: GearKernel, label: string, fn: () => BrepHandleType, ref: number): void {
  try {
    const s = fn()
    const v = kernel.getVolume(s)
    console.log(`  ${label}: ${v.toFixed(4)}  rel-vs-ref=${(Math.abs(v - ref) / ref).toExponential(3)}`)
  } catch (e) {
    console.log(`  ${label}: ERROR ${(e as Error).message}`)
  }
}

type BrepHandleType = Awaited<ReturnType<typeof getGearKernel>> extends never ? never : Parameters<GearKernel['getVolume']>[0]

async function main(): Promise<void> {
  const kernel = await getGearKernel()
  const m = loadManifest()
  for (const id of ['case04-SpurGear', 'case06-HerringboneGear', 'case02-SpurGear']) {
    const c = m.cases.find((x) => x.id === id)!
    const a = c.args as Record<string, number>
    const ref = c.volume ?? 0
    const params = {
      module: a.module, teeth_number: a.teeth_number, width: a.width,
      pressure_angle: a.pressure_angle ?? 20, helix_angle: a.helix_angle ?? 0,
    }
    const geom = spurGearGeometry(params as never)
    const opts: GearFeatureOptions = {
      chamfer: a.chamfer, boreD: a.bore_d,
      hubD: a.hub_d, hubLength: a.hub_length,
      recess: a.recess, recessD: a.recess_d,
      nSpokes: a.n_spokes, spokeWidth: a.spoke_width,
      spokesId: a.spokes_id, spokesOd: a.spokes_od, spokeFillet: a.spoke_fillet,
    }
    console.log(`${id}: ref=${ref.toFixed(4)}  (n=${a.n_spokes}, sw=${a.spoke_width}, fillet=${a.spoke_fillet})`)
    stageVol(kernel, 'chamfer+bore          ', () => buildSpurGearSolid(kernel, params as never, { chamfer: a.chamfer, boreD: a.bore_d }), ref)
    stageVol(kernel, '+recess               ', () => buildSpurGearSolid(kernel, params as never, { chamfer: a.chamfer, boreD: a.bore_d, recess: a.recess, recessD: a.recess_d, hubD: a.hub_d }), ref)
    stageVol(kernel, '+hub                  ', () => buildSpurGearSolid(kernel, params as never, { chamfer: a.chamfer, boreD: a.bore_d, recess: a.recess, recessD: a.recess_d, hubD: a.hub_d, hubLength: a.hub_length }), ref)
    stageVol(kernel, '+spokes(no fillet)    ', () => buildSpurGearSolid(kernel, params as never, { ...opts, spokeFillet: undefined }), ref)
    stageVol(kernel, '+spokes(with fillet)  ', () => buildSpurGearSolid(kernel, params as never, opts), ref)
  }
}

void main()
