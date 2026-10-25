/**
 * execute-op-dims — 执行期量纲门禁（2026-10-25，阶段 3）
 *
 * 阶段 1 的常开 walker 修掉了「节点内算术」的量纲错误（`**` / `10 + MM`），
 * 阶段 2 给 `inferDim` 接了变量量纲环境，但**槽位判据**（`checkDim`）仍只在
 * `check()` 里跑 —— `runtime.ts` 的三处 extractMetadata（execute / append /
 * update）不传 `opDims`。结果是同一条脚本 web 门禁拒、小程序执行成功。
 *
 * 阶段 3 把 `opDims` 接到那三处。本文件钉住：
 *
 * 1. 三条路径（execute / append / update）都按同一套槽位判据拒绝角度裸数字；
 * 2. 槽位级裸数字政策不变 —— `cad.box(20, 20, 20)` 永远放行（默认 mm）；
 * 3. `opDims` 有缓存（每条指令都要它，构建要遍历整个 libs 表），且注册新库后失效。
 *
 * 历史背景：`runtime.ts` 曾有一条 2026-10-21 的 NOTE，说接上 opDims 会让全仓
 * 703 个测试失败（语料普遍写裸数字）。那批失败全部由 **length 槽位的裸数字**触发，
 * 而 2026-10-25 的 R2 收窄让 length/mass/time 的裸数字合法 ⇒ 那批失败不再触发。
 */
import { describe, it, expect } from 'vitest'
import { createRuntime } from '../../src/cad-runtime/runtime'
import type { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts, EventSink } from '../../src/cad-runtime/ports'
import { ParseError } from '../../src/lang/parse-error'
import { defineOp } from '../../src/define-op'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
}

function runtime(): CadRuntime {
  return createRuntime({ events: new TestEventSink() } as HostPorts)
}

function wrap(body: string): string {
  return `export default async (cad) => {\n${body.replace(/^/gm, '  ')}\n}`
}

/** 跑 execute，返回错误码（成功则 'OK'）与行号。 */
async function execCode(rt: CadRuntime, code: string): Promise<{ code: string; line?: number }> {
  try {
    await rt.execute(code)
    return { code: 'OK' }
  } catch (err) {
    if (!(err instanceof ParseError)) throw err
    return { code: String(err.code), line: err.line }
  }
}

const BOX = 'const p0 = cad.box(20 * MM, 20 * MM, 20 * MM)'

// ── 1. execute：角度槽位裸数字被拒（阶段 3 的核心收益） ──

describe('execute 也跑槽位判据', () => {
  it('angles: [45, 0, 0] → E_DIM_BARE_NUMBER（此前 execute 静默通过）', async () => {
    const r = await execCode(runtime(), wrap(`${BOX}\nconst p1 = cad.rotate_euler(p0, { angles: [45, 0, 0] })\nreturn { shape: p1 }`))
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('const tilt = 45 → angles: [tilt, 0, 0] → E_DIM_BARE_NUMBER（变量中转也拦）', async () => {
    const r = await execCode(runtime(), wrap(`${BOX}\nconst tilt = 45\nconst p1 = cad.rotate_euler(p0, { angles: [tilt, 0, 0] })\nreturn { shape: p1 }`))
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('const a = 10 * MM 当角度用 → E_DIM_MISMATCH（长度当角度）', async () => {
    const r = await execCode(runtime(), wrap(`${BOX}\nconst a = 10 * MM\nconst p1 = cad.rotate_euler(p0, { angles: [a, a, a] })\nreturn { shape: p1 }`))
    expect(r.code).toBe('E_DIM_MISMATCH')
  })

  it('扁平代码（weapp sceneCode 就是这种）的行号 = 用户看到的行', async () => {
    // 扁平代码由 faijs 包进 `export default async (ns) => {` 再解析；报错行号必须扣掉
    // 包装头的偏移，否则小程序上每条量纲错误都指向下一行。
    const flat = 'const p0 = cad.box(20, 20, 20)\nconst p1 = cad.rotate_euler(p0, { angles: [45, 0, 0] })'
    const r = await execCode(runtime(), flat)
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
    expect(r.line).toBe(2)
  })

  it('draft 的 angleDeg 同样被拦（对象形态槽位）', async () => {
    const r = await execCode(runtime(), wrap(`const p0 = cad.box(20, 20, 10)\nconst p1 = cad.draft(p0, { faces: ">X", angleDeg: 3 })\nreturn { shape: p1 }`))
    expect(r.code).toBe('E_DIM_BARE_NUMBER')
  })
})

// ── 2. 槽位级裸数字政策不变（拍板 6 / 8） ──

describe('裸数字政策不变（length 放行 / 0 例外）', () => {
  it('cad.box(20, 20, 20) → 正常执行（length 裸数字 = mm）', async () => {
    const rt = runtime()
    const r = await execCode(rt, wrap('const p0 = cad.box(20, 20, 20)\nreturn { shape: p0 }'))
    expect(r.code).toBe('OK')
    expect(rt.getCachedOutput('p0' as never)).toBeDefined()
  })

  it('angles: [0, 0, 0] → 正常执行（所有度量里的 0 都放行）', async () => {
    const r = await execCode(runtime(), wrap(`${BOX}\nconst p1 = cad.rotate_euler(p0, { angles: [0, 0, 0] })\nreturn { shape: p1 }`))
    expect(r.code).toBe('OK')
  })

  it('angles: [45 * DEGREE, 0, 0] → 正常执行', async () => {
    const r = await execCode(runtime(), wrap(`${BOX}\nconst p1 = cad.rotate_euler(p0, { angles: [45 * DEGREE, 0, 0] })\nreturn { shape: p1 }`))
    expect(r.code).toBe('OK')
  })

  it('angles: [0, 0, 45 * DEGREE] → 正常执行（顺序不影响判定）', async () => {
    // `inferDim(ArrayExpression)` 只看首元素：首元素是 0 就会被判成 bare，合规写法被误报。
    // 槽位判据改成**逐元素**判定后，单位写在哪个位置都一样。
    const r = await execCode(runtime(), wrap(`${BOX}
const p1 = cad.rotate_euler(p0, { angles: [0, 0, 45 * DEGREE] })
return { shape: p1 }`))
    expect(r.code).toBe('OK')
  })

  it('angles: [0, 0, 45] → 报错指向真正违约的那个元素（不是整个数组）', async () => {
    const rt = runtime()
    let message = ''
    try {
      await rt.execute(wrap(`${BOX}
const p1 = cad.rotate_euler(p0, { angles: [0, 0, 45] })
return { shape: p1 }`))
      expect.unreachable('should have been rejected')
    } catch (err) {
      if (!(err instanceof ParseError)) throw err
      expect(err.code).toBe('E_DIM_BARE_NUMBER')
      message = err.message
    }
    expect(message).toContain('"45"')
    expect(message).not.toContain('[0, 0, 45]')
  })

  it('角度经带单位的变量中转 → 正常执行', async () => {
    const r = await execCode(runtime(), wrap(`${BOX}\nconst tilt = 30 * DEGREE\nconst p1 = cad.rotate_euler(p0, { angles: [tilt, 0, 0] })\nreturn { shape: p1 }`))
    expect(r.code).toBe('OK')
  })
})

// ── 3. append 路径 ──

describe('append 路径同样受门禁', () => {
  it('append 一条含角度裸数字的语句 → E_DIM_BARE_NUMBER', async () => {
    const rt = runtime()
    await rt.execute(`let part0 = cad.box(20, 20, 20, { centered: true })`)
    await expect(rt.append('let part1 = cad.rotate_euler(part0, { angles: [45, 0, 0] })'))
      .rejects.toThrow(/angle slot/)
  })

  it('append 带单位的角度 → 正常执行', async () => {
    const rt = runtime()
    await rt.execute(`let part0 = cad.box(20, 20, 20, { centered: true })`)
    const result = await rt.append('let part1 = cad.rotate_euler(part0, { angles: [45 * DEGREE, 0, 0] })')
    expect(result.failedAt ?? null).toBeNull()
    expect(result.terminals.some((t) => String(t.id) === 'part1')).toBe(true)
  })
})

// ── 4. update（增量重放）路径 ──

describe('update 路径同样受门禁', () => {
  const BASE = [
    'let part0 = cad.box(20, 20, 20, { centered: true })',
    'let part1 = cad.rotate_euler(part0, { angles: [30 * DEGREE, 0, 0] })',
  ].join('\n')

  it('把角度改成裸数字 → E_DIM_BARE_NUMBER', async () => {
    const rt = runtime()
    const a = await rt.execute(BASE)
    expect(a.failedAt ?? null).toBeNull()
    const changed = BASE.replace('30 * DEGREE', '30')
    await expect(rt.update(BASE, changed)).rejects.toThrow(/angle slot/)
  })

  it('把角度改成另一个带单位的值 → 正常增量执行', async () => {
    const rt = runtime()
    await rt.execute(BASE)
    const changed = BASE.replace('30 * DEGREE', '60 * DEGREE')
    const result = await rt.update(BASE, changed)
    expect(result.failedAt ?? null).toBeNull()
  })
})

// ── 5. opDims 缓存 ──

describe('opDims 缓存与失效', () => {
  it('同一 runtime 两次取到同一个对象（不重复遍历 libs）', () => {
    const rt = runtime()
    expect(rt.getOpDims()).toBe(rt.getOpDims())
  })

  it('注册新库后失效：新 op 的量纲声明立即可见', async () => {
    const rt = runtime()
    const before = rt.getOpDims()
    expect(Object.keys(before).some((k) => k.startsWith('extra.'))).toBe(false)

    // 只要元数据（paramDims 挂在 dual-op 的 DUAL_OP_META 上），不执行几何
    const turn = defineOp({
      brep: () => null as never,
      naming: { kind: 'unmodeled', reason: 'test' },
      paramDims: { angles: 'angle' },
      name: 'turn',
    })
    rt.registerLib('extra', { turn } as never)
    const after = rt.getOpDims()
    expect(after).not.toBe(before)
    expect(after['extra.turn']?.paramDims).toEqual({ angles: 'angle' })
  })
})
