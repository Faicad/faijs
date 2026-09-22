/**
 * Phase 4.3 审计：`unmodeled` 全部进白名单 + 每条给理由。
 *
 * 计划 §4.3 / §6 总验收：「未命名面数必须为 0，且无法命名的面必须有可枚举、
 * 可归因的理由」。凡无法给面命名（无稳定构造词汇 / 纯 mesh）的 op，必须显式
 * 声明 `naming: { kind: 'unmodeled', reason }`（D11 对第三方库是 breaking）。
 *
 * 本测试是这份白名单的**快照审计**：列出全部生产态 `unmodeled` op 及其理由，
 * 断言每条理由非空。新增 `unmodeled` 必须同步更新本表（计划要求「列出全部」）。
 *
 * ⚠️ 已知陈旧（清理项，见 Agent Note）：`* pending Phase 3` 类理由在 Phase 3 已
 * 落地后不再准确，应改写为「构造类原始面体词汇未定义」等真实理由；当前仍按
 * 源码现状登记，不在此测试内判定陈旧（避免把文档性判定混入审计）。
 */
import { describe, it, expect } from 'vitest'

interface UnmodeledEntry {
  /** op 名（cad 命名空间） */
  op: string
  /** 源码中登记的 unmodeled 理由（须非空） */
  reason: string
}

/**
 * 生产态 `unmodeled` 白名单（来自仓库实盘，2026-09-22）：
 *
 * - `knurl` / `sdf`：`packages/core/src/api/{knurl,sdf}.ts` — mesh-only，无 BREP 面身份。
 * - `sphere` / `wedge`：`packages/core/src/api/primitives.ts` — 构造类原始面体词汇待定义。
 * - `torus` / `convexHull` / `makeBaseBox` / `ellipsoid`：`api/surface/arg-spec.ts`
 *   （生成投影）— 构造类词汇待定义。
 *
 * 不在表内：`admitCompatLib` 的 `unmodeled` 是裸函数提升的元理由（非 op）；
 * 测试夹具里的 `unmodeled` 是单测假数据。
 */
const WHITELIST: readonly UnmodeledEntry[] = [
  { op: 'knurl', reason: 'knurl is mesh-only, no BREP face identity' },
  { op: 'sdf', reason: 'sdf is mesh-only, no BREP face identity' },
  { op: 'sphere', reason: 'sphere face vocabulary pending Phase 3' },
  { op: 'wedge', reason: 'wedge face vocabulary pending Phase 3' },
  { op: 'torus', reason: 'construct vocabulary pending Phase 3' },
  { op: 'convexHull', reason: 'construct vocabulary pending Phase 3' },
  { op: 'makeBaseBox', reason: 'construct vocabulary pending Phase 3' },
  { op: 'ellipsoid', reason: 'construct vocabulary pending Phase 3' },
]

describe('Phase 4.3：unmodeled 白名单审计', () => {
  it('每条 unmodeled 都给出非空理由', () => {
    expect(WHITELIST.length, '白名单不应为空').toBeGreaterThan(0)
    for (const e of WHITELIST) {
      expect(e.reason, `[${e.op}] unmodeled 必须给出理由`).not.toBe('')
      expect(e.reason.trim().length, `[${e.op}] 理由不能是空白`).toBeGreaterThan(0)
    }
  })

  it('白名单自洽：op 名唯一', () => {
    const names = WHITELIST.map((e) => e.op)
    expect(new Set(names).size, '白名单存在重复 op').toBe(names.length)
  })
})
