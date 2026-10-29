/**
 * update-after-retessellate.probe — refine 后增量 update 崩溃探针（2026-10-29）。
 *
 * 真机症状（weapp 皮卡丘，3d_editor 仓）：execute → retessellate（LOD refine）
 * → AI 编辑 → update 增量 → `[smlib-kernel] getSubShapes(face): bridge failed
 * (n=1001, …)`；大脚本升级为 wasm `memory access out of bounds`；真机读悬垂
 * 堆产生 NaN 顶点（页面侧 THREE computeBoundingBox NaN 告警、NaN 相机、整画布空白）。
 *
 * node 复现（3d_editor 临时 worker-sim 脚本已钉）：
 *  · 无 retessellate → update（后缀重放 / 全重放）全部通过；
 *  · retessellate 之后 → update 必崩；**无 splitByPlane 的对照组同样崩** →
 *    触发链 = retessellate × update 增量交互，与 split 无关。
 *
 * 根因（2026-10-29 探针实证，disposeHandle 监视 + solidCache 转储钉死）：
 *  1. smlib 变换类 op 原地写回 → 多个 solidCache 条目共享同一句柄
 *     （eye=eyeMoved=0x…、ball=scaled=body=0x… 同值）；
 *  2. releasePartCaches(replayKeys) 无视共享，真删 eyeMoved 句柄 → eye 条目悬垂，
 *     重放在已释放内存上执行（node ghost 调用侥幸通过；真机读悬垂堆出 NaN 顶点）；
 *  3. 重放失败降级全量后，setSolidAndTess 的陈旧 prev 守卫 × 分配器地址复用
 *     （旧 eye 块被新 ball 复用）真删活体 → 收尾 getSubShapes SM_ERR=1001
 *     （大脚本 wasm `memory access out of bounds`）。
 * 修复：disposeSolidHandle 共享句柄守卫（最后一个引用者释放）+ 调用方先删键/覆盖
 * 再释放（releasePartCaches / setSolidAndTess / dispose 顺序调整）。
 * 本测试守护不变量：refine 后增量 update，solidCache 全部句柄仍存活可查询。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import type { TessellationDensity } from '../../src/runtime-state'
import type { PartName } from '../../src/identity'
import { createRuntime } from '../../src/cad-runtime/runtime'
import { configureTessellation } from '../../src/runtime-state'
import {
  __resetEngineRegistriesForTests,
  getActiveBrepEngineId,
} from '../../src/brep/engine/registry'
import {
  registerSmlibBrepEngine,
  SMLIB_BREP_ENGINE_ID,
} from '../../src/brep/engine/adapters/smlib'

/** L0 执行档（weapp faijs.worker.ts 同值）。 */
const L0: TessellationDensity = {
  angularDeflection: (2 * Math.PI) / 16,
  linearMode: 'bbox-relative',
}
/** L1 精化目标（weapp refine-controller.ts 同值）。 */
const L1: TessellationDensity = { angularDeflection: (2 * Math.PI) / 32, linearDeflection: 0.1 }

/**
 * 最小复现脚本（无 splitByPlane —— 对照组，剥离 split 变量后仍然崩溃）。
 * update 场景：改 `eyeMoved` 行（第 5 行）→ 仅后缀（5-6 行）重放，
 * 前缀（ball/scaled/body/eye）保留、由重放的 group / 收尾拓扑重建继续消费。
 */
const CODE = [
  'const ball = cad.sphere({ radius: 1 * MM, segments: 32 })',
  'const scaled = cad.scale3d(ball, { factor: [7, 6, 20] })',
  'const body = cad.translate(scaled, { offset: [0 * MM, 0 * MM, 10 * MM] })',
  'const eye = cad.sphere({ radius: 5 * MM, segments: 48 })',
  'const eyeMoved = cad.translate(eye, { offset: [13 * MM, 0 * MM, 5 * MM] })',
  'const g = cad.group(body, eyeMoved)',
].join('\n')

function ports(): HostPorts {
  return { events: { emit: () => undefined } } as HostPorts
}

function makeWeappRuntime() {
  return createRuntime(ports(), 'auto', undefined, {
    execBackend: 'interpreter',
    tessellationTiming: 'eager',
    tessellation: L0,
  })
}

describe('update × retessellate 交互（refine 后增量重放）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerSmlibBrepEngine()
    expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  }, 120000)

  afterAll(() => {
    configureTessellation({ angularDeflection: (2 * Math.PI) / 64, linearDeflection: 0.1 })
    __resetEngineRegistriesForTests()
  })

  it('对照：无 retessellate，update（后缀重放）正常', async () => {
    const runtime = makeWeappRuntime()
    try {
      const r1 = await runtime.execute(CODE)
      expect(r1.failedAt).toBeUndefined()
      const next = CODE.replace('13 * MM', '12 * MM')
      const r2 = await runtime.update(CODE, next)
      expect(r2.failedAt).toBeUndefined()
    } finally {
      runtime.dispose()
    }
  }, 180000)

  it('崩溃探针：retessellate 后 update（后缀重放）不得触死句柄', async () => {
    const runtime = makeWeappRuntime()
    try {
      const r1 = await runtime.execute(CODE)
      expect(r1.failedAt).toBeUndefined()
      const names: PartName[] = r1.terminals.map((t) => t.id)
      const out = await runtime.retessellate(names.map((partName) => ({ partName, density: L1 })))
      expect(Object.keys(out).length).toBeGreaterThan(0)
      const next = CODE.replace('13 * MM', '12 * MM')
      const r2 = await runtime.update(CODE, next)
      expect(r2.failedAt).toBeUndefined()
      // 回归断言（杀链结论留档，见文件头「根因」）：update 后 solidCache 全部句柄
      // 必须仍可查询。修复前 releasePartCaches 真删共享句柄（smlib 原地变换
      // eye=eyeMoved 同值）→ 重放在已释放内存上跑；降级全量后 setSolidAndTess
      // 陈旧 prev × 分配器地址复用真删活体 → getSubShapes SM_ERR=1001（大脚本
      // wasm OOB）。
      const chain = (runtime as unknown as {
        brepChain: {
          solidCache: Map<PartName, number>
          kernel: { getSubShapes(handle: number, kind: string): number[] }
        }
        topologyCache: Map<string, unknown>
      })
      expect(chain.brepChain.solidCache.size).toBeGreaterThan(0)
      for (const [part, handle] of chain.brepChain.solidCache) {
        expect(
          () => chain.brepChain.kernel.getSubShapes(handle, 'face'),
          `update 后 solidCache 句柄必须存活可查询：part=${part} handle=${handle}`,
        ).not.toThrow()
      }
      // 拓扑红线（拓扑必须与显示 mesh 一一对应）：refine 清空 topologyCache 后，
      // update 收尾必须从活体 solid + 精化 mesh 重建终端拓扑。
      expect(chain.topologyCache.has('body')).toBe(true)
      expect(chain.topologyCache.has('eyeMoved')).toBe(true)
    } finally {
      runtime.dispose()
    }
  }, 180000)
})
