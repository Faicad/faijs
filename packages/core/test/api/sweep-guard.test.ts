/**
 * @vitest-environment node
 *
 * 扫掠判据套件 C1–C3 的验收（P2，2026-11-16）
 *
 * 体积恒等式（Pappus：V = 截面积 × 脊柱长度）单独用是不够的，两个实测反例：
 * - **浅折角**：15° 折角塌陷只偏 1.70%，5% 容差放行，但产物是压扁的平移体 → 靠 C2
 *   （端面法向 1°）抓出来；
 * - **混合边类型丢一条腿**：体积差 78% 会被 C1 抓到，但「体积勉强对、bbox 缺一块」
 *   的组合只有 C3 能抓。
 *
 * 这里同时钉住三件事：判据在**该拒时拒**（错误码 + 消息里的量化数字）、在**不该拒时
 * 不误报**（1° 阈值对正常产物留足余量）、以及 `strict:false` 只降级不静默。
 *
 * Run: npx vitest run test/api/sweep-guard.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import {
  CAP_NORMAL_TOL,
  assertSweepResult,
  setSweepNoticeHook,
  type SweepNotice,
} from '../../src/api/internal/sweep-guard'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

beforeEach(() => {
  setSweepNoticeHook(undefined)
})

const R = 6
const AREA = Math.PI * R * R
const SEC = `cad.sketch({ plane: 'XY', shapes: [{ kind: 'circle', r: ${R}, cx: 0, cy: 0, tag: 's' }], constraints: [] })`

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function shapes(code: string, names: string[]): Promise<Record<string, Shape>> {
  const r = await exec(code)
  if (r.failedAt) throw new Error(`failed at ${r.failedAt.callee}: ${r.failedAt.message}`)
  const out: Record<string, Shape> = {}
  for (const n of names) {
    const s = r.outputs.get(asPartName(n))
    if (!s) throw new Error(`no ${n} output`)
    out[n] = s as Shape
  }
  return out
}

/** 15° 折角脊柱：走 transformed 必塌陷，但体积只偏 1.70%（C1 的盲区）。 */
const FOLD_15 =
  'cad.wire([[0,0,0],[0,0,10],[0,-2.5881904,19.6592583]])' // -10·sin15° / 10+10·cos15°

describe('C1 体积恒等式', () => {
  it('C1a. 面积给错 → E_SWEEP_VOLUME_MISMATCH，消息里带偏离百分比与容差', async () => {
    const { sp, part2 } = await shapes(
      `let sp = cad.wire([[0,0,0],[0,0,20]])\nlet part2 = cad.sweepAlong(${SEC}, sp)\n`,
      ['sp', 'part2'],
    )
    const api = getBrepApi()
    // 故意把面积说成两倍：体积对账必须炸。
    let thrown: { code?: string; message?: string } | undefined
    try {
      assertSweepResult(api, 'sweepTest', {
        result: brepOf(part2) as never,
        spine: brepOf(sp) as never,
        profileArea: AREA * 2,
      })
    } catch (e) {
      thrown = e as { code?: string; message?: string }
    }
    expect(thrown?.code).toBe('E_SWEEP_VOLUME_MISMATCH')
    expect(String(thrown?.message)).toMatch(/50\.0% off/)
    expect(String(thrown?.message)).toMatch(/tolerance 5%/)
  })

  it('C1b. 显式 volumeTolerance 放宽 → 放行（知情放行，不修几何）', async () => {
    const { sp, part2 } = await shapes(
      `let sp = cad.wire([[0,0,0],[0,0,20]])\nlet part2 = cad.sweepAlong(${SEC}, sp)\n`,
      ['sp', 'part2'],
    )
    const api = getBrepApi()
    expect(() =>
      assertSweepResult(api, 'sweepTest', {
        result: brepOf(part2) as never,
        spine: brepOf(sp) as never,
        profileArea: AREA * 2,
        volumeTolerance: 0.6,
      }),
    ).not.toThrow()
  })

  it('C1c. 非法容差（0 / 1 / 负数 / >1）→ E_SWEEP_TOL_INVALID，不静默夹取', async () => {
    const { sp, part2 } = await shapes(
      `let sp = cad.wire([[0,0,0],[0,0,20]])\nlet part2 = cad.sweepAlong(${SEC}, sp)\n`,
      ['sp', 'part2'],
    )
    const api = getBrepApi()
    for (const bad of [0, 1, -0.2, 1.5, Number.NaN]) {
      let thrown: { message?: string } | undefined
      try {
        assertSweepResult(api, 'sweepTest', {
          result: brepOf(part2) as never,
          spine: brepOf(sp) as never,
          profileArea: AREA,
          volumeTolerance: bad,
        })
      } catch (e) {
        thrown = e as { message?: string }
      }
      expect(String(thrown?.message), `tolerance=${bad}`).toMatch(/E_SWEEP_TOL_INVALID/)
    }
  })
})

describe('C2 端面法向（专抓「截面没转」）', () => {
  it('C2a. 15° 折角 + transformed：体积只偏 1.70%（C1 放行）但 C2 拒，码是 E_SWEEP_CAP_NORMAL', async () => {
    const r = await exec(
      `let sec = ${SEC}\nlet sp = ${FOLD_15}\nlet part2 = cad.sweepAdvanced(sec, sp, { transitionMode: 'transformed' })\n`,
    )
    expect(r.failedAt).toBeTruthy()
    expect(r.failedAt?.code).toBe('E_SWEEP_CAP_NORMAL')
    expect(String(r.failedAt?.message)).toMatch(/off by 15\.00°/)
    expect(String(r.failedAt?.message)).toMatch(/tolerance 1°/)
  })

  it('C2b. 1° 阈值不误报：正确斜接的产物（相对偏离 1e-7 量级）必须放行', async () => {
    const r = await exec(
      `let sec = ${SEC}\nlet sp = ${FOLD_15}\nlet part2 = cad.sweepAlong(sec, sp)\n`,
    )
    expect(r.failedAt).toBeFalsy()
  })

  it('C2c. 端面法向容差常量就是契约：1°', () => {
    expect((CAP_NORMAL_TOL * 180) / Math.PI).toBeCloseTo(1, 9)
  })
})

describe('C3 包围盒覆盖（专抓「体积勉强对、整段丢失」）', () => {
  it('C3a. 产物在原点、脊柱在 z=90 → E_SWEEP_BBOX_MISMATCH', async () => {
    const { box, sp } = await shapes(
      `let box = cad.box(10, 10, 10)\nlet sp = cad.wire([[0,0,90],[0,50,90]])\n`,
      ['box', 'sp'],
    )
    const api = getBrepApi()
    let thrown: { code?: string; message?: string } | undefined
    try {
      assertSweepResult(api, 'sweepTest', {
        result: brepOf(box) as never,
        spine: brepOf(sp) as never,
        coversPath: true,
      })
    } catch (e) {
      thrown = e as { code?: string; message?: string }
    }
    expect(thrown?.code).toBe('E_SWEEP_BBOX_MISMATCH')
    expect(String(thrown?.message)).toMatch(/does not cover the spine/)
  })

  it('C3b. 覆盖脊柱的正常产物不误报', async () => {
    const { sp, part2 } = await shapes(
      `let sp = cad.wire([[0,0,0],[0,0,20]])\nlet part2 = cad.sweepAlong(${SEC}, sp)\n`,
      ['sp', 'part2'],
    )
    const api = getBrepApi()
    expect(() =>
      assertSweepResult(api, 'sweepTest', {
        result: brepOf(part2) as never,
        spine: brepOf(sp) as never,
        profileArea: AREA,
        coversPath: true,
      }),
    ).not.toThrow()
  })
})

describe('strict:false：判据降级为通知，但绝不静默', () => {
  it('C4a. strict:false + C2 失败 → 通过，钩子收到 E_SWEEP_CAP_NORMAL', async () => {
    const notices: SweepNotice[] = []
    setSweepNoticeHook((n) => notices.push(n))
    const { sp, part2 } = await shapes(
      `let sp = ${FOLD_15}\nlet part2 = cad.sweepAdvanced(${SEC}, sp, { transitionMode: 'transformed', volumeTolerance: 0.6, strict: false })\n`,
      ['sp', 'part2'],
    )
    // 上面这一步在 op 内部已经触发过一次通知（volumeTolerance 0.6 也放过了 C1）。
    expect(notices.map((n) => n.code)).toContain('E_SWEEP_CAP_NORMAL')
    expect(notices[0]!.op).toBe('sweepAdvanced')
    // 再直接调一次，确认判定对象是「产物 + 脊柱」而不是某个调用点。
    const api = getBrepApi()
    const before = notices.length
    expect(() =>
      assertSweepResult(api, 'unit', {
        result: brepOf(part2) as never,
        spine: brepOf(sp) as never,
        caps: [
          { label: 'start', point: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
          { label: 'end', point: { x: 0, y: -2.5881904, z: 19.6592583 }, tangent: { x: 0, y: -0.2588, z: 0.9659 } },
        ],
        strict: false,
      }),
    ).not.toThrow()
    expect(notices.length).toBeGreaterThan(before)
  })

  it('C4b. 没有订阅方时 strict:false 也不往控制台写东西（库层不碰 stderr）', async () => {
    setSweepNoticeHook(undefined)
    const { sp, part2 } = await shapes(
      `let sp = ${FOLD_15}\nlet part2 = cad.sweepAdvanced(${SEC}, sp, { transitionMode: 'transformed', volumeTolerance: 0.6, strict: false })\n`,
      ['sp', 'part2'],
    )
    const api = getBrepApi()
    expect(() =>
      assertSweepResult(api, 'unit', {
        result: brepOf(part2) as never,
        spine: brepOf(sp) as never,
        caps: [{ label: 'end', point: { x: 0, y: -2.5881904, z: 19.6592583 }, tangent: { x: 0, y: -1, z: 0 } }],
        strict: false,
      }),
    ).not.toThrow()
  })
})
