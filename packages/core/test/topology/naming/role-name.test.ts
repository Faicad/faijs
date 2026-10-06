/**
 * role-name.test.ts — `RoleName` 序列化契约的防回归测试（计划 §4.2 / Phase 1.1）。
 *
 * ## 为什么这些断言值这么写
 *
 * - **round-trip 是值级的，不是串级的**：`parse(format(r))` 必须 deepEqual `r`。
 *   只断言"串没变"不够——两个不同的 RoleName 若序列化成同一个串，
 *   `.fai.js` 里的引用会**静默指向错的面**，而且不会有任何报错。
 *   故另有一条**单射**测试：语料内任意两个不同的 RoleName 串必须不同。
 * - **非法输入必须 `null` 或抛错，不能"尽力猜"**：解析发生在读 `.fai.js` 参数时，
 *   猜错等于把用户的引用指到别的面上。`parseRoleName` 返回 `null`（调用方据此走迁移器），
 *   `formatRoleName`/构造子抛 `RoleNameError`（值在产生点就非法）。
 * - **保留字冲突是真实风险**：`semantic{'wall'}` 若被允许，它和 `wall:{index:3}`
 *   会分别格式化成 `wall` 与 `wall:3`——目前不冲突，但 `semantic{'hole'}` 与
 *   `hole` 的前缀写法只差一个字符，一旦将来 inner 可省略就会互相吃掉。**现在就堵死。**
 */

import { describe, it, expect } from 'vitest'
import {
  type RoleName,
  ROLE_NAME_KINDS,
  RoleNameError,
  formatRoleName,
  parseRoleName,
  semantic,
  wall,
  hole,
  replica,
  splinter,
  generated,
  imported,
} from '../../../src/topology/naming/role-name'

/** 覆盖全部 7 个 kind 的语料，含计划 §4.2 点名的嵌套形态。 */
const CORPUS: readonly RoleName[] = [
  // 1. semantic（op 词汇表封闭）
  { kind: 'semantic', name: 'top' },
  { kind: 'semantic', name: 'bottom' },
  { kind: 'semantic', name: 'lateral' },
  { kind: 'semantic', name: 'start' },
  // 2. wall —— 第 i 条 profile 边扫出的侧面（不是"第 i 张面"）
  { kind: 'wall', index: 0 },
  { kind: 'wall', index: 3 },
  // 3. hole —— 内环下的同名子结构（inner 递归）
  { kind: 'hole', index: 0, inner: { kind: 'semantic', name: 'lateral' } },
  { kind: 'hole', index: 1, inner: { kind: 'wall', index: 2 } },
  // 4. replica —— pattern 第 k 份（inner 递归）
  { kind: 'replica', k: 0, inner: { kind: 'semantic', name: 'top' } },
  { kind: 'replica', k: 2, inner: { kind: 'wall', index: 3 } },
  // 5. splinter —— split 第 j 片（inner 递归）
  { kind: 'splinter', inner: { kind: 'semantic', name: 'top' }, index: 1 },
  { kind: 'splinter', inner: { kind: 'wall', index: 0 }, index: 0 },
  // 6. generated —— 倒角/圆角过渡面
  { kind: 'generated', op: 'fillet', index: 0 },
  { kind: 'generated', op: 'chamfer', index: 2 },
  // 7. imported —— import_brep 原始面序
  { kind: 'imported', index: 0 },
  { kind: 'imported', index: 5 },
  // 计划 §4.2 点名的深层嵌套
  {
    kind: 'replica',
    k: 2,
    inner: { kind: 'hole', index: 1, inner: { kind: 'wall', index: 3 } },
  },
]

describe('RoleName 序列化：7 个 kind + 嵌套', () => {
  it('语料覆盖全部 7 个 kind（防止将来加 kind 却忘了加用例）', () => {
    const seen = new Set(CORPUS.map((r) => r.kind))
    expect([...seen].sort()).toEqual([...ROLE_NAME_KINDS].sort())
  })

  it('串形态与计划 §4.2 逐条一致', () => {
    expect(formatRoleName({ kind: 'semantic', name: 'top' })).toBe('top')
    expect(formatRoleName({ kind: 'wall', index: 3 })).toBe('wall:3')
    expect(
      formatRoleName({ kind: 'hole', index: 1, inner: { kind: 'wall', index: 2 } }),
    ).toBe('hole:1/wall:2')
    expect(
      formatRoleName({ kind: 'replica', k: 2, inner: { kind: 'wall', index: 3 } }),
    ).toBe('replica[2]/wall:3')
    expect(
      formatRoleName({ kind: 'splinter', inner: { kind: 'semantic', name: 'top' }, index: 1 }),
    ).toBe('splinter(top)#1')
    expect(formatRoleName({ kind: 'generated', op: 'fillet', index: 0 })).toBe('gen:fillet:0')
    expect(formatRoleName({ kind: 'imported', index: 5 })).toBe('imported:5')
  })

  it.each(CORPUS.map((r) => [formatRoleName(r), r] as const))(
    'round-trip：%s 解析回原值',
    (text, role) => {
      expect(parseRoleName(text)).toEqual(role)
    },
  )

  it('单射：语料内任意两个不同的 RoleName 序列化结果不同', () => {
    const texts = CORPUS.map(formatRoleName)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('括号嵌套不会误切：splinter(splinter(top)#1)#2', () => {
    const role = splinter(splinter(semantic('top'), 1), 2)
    const text = formatRoleName(role)
    expect(text).toBe('splinter(splinter(top)#1)#2')
    expect(parseRoleName(text)).toEqual(role)
  })

  it('index 前导零被拒绝（否则 parse 不单射：wall:01 与 wall:1 同值不同串）', () => {
    expect(parseRoleName('wall:01')).toBeNull()
    expect(parseRoleName('imported:00')).toBeNull()
    expect(parseRoleName('gen:fillet:00')).toBeNull()
    // 单个 0 合法
    expect(parseRoleName('wall:0')).toEqual({ kind: 'wall', index: 0 })
  })

  it('负数 / 非整数被构造子拒绝（值在产生点就非法，不留到 format 才炸）', () => {
    expect(() => wall(-1)).toThrow(RoleNameError)
    expect(() => wall(1.5)).toThrow(RoleNameError)
    expect(() => imported(-3)).toThrow(RoleNameError)
    // 记录错误码（宿主/args 校验按码识别）
    try {
      hole(-1, semantic('top'))
      expect.unreachable('hole(-1) 应当抛错')
    } catch (e) {
      expect((e as RoleNameError).code).toBe('E_TOPO_ROLE_INVALID')
    }
  })

  it('保留字不得作 semantic 名（否则与结构 kind 的前缀写法互相吃掉）', () => {
    for (const kw of ['wall', 'hole', 'replica', 'splinter', 'gen', 'imported']) {
      expect(() => semantic(kw), `semantic(${kw}) 应当抛错`).toThrow(RoleNameError)
      expect(parseRoleName(kw), `裸 "${kw}" 不是合法 role 串`).toBeNull()
    }
  })

  it('semantic 名限定字符集：空串 / 含分隔符 / 起始非字母下划线均非法', () => {
    expect(() => semantic('')).toThrow(RoleNameError)
    expect(() => semantic('top:bottom')).toThrow(RoleNameError)
    expect(() => semantic('1top')).toThrow(RoleNameError)
    expect(() => semantic('to p')).toThrow(RoleNameError)
    expect(parseRoleName('top:bottom')).toBeNull()
  })

  it('generated 的 op 名同样受限（保证 gen:<op>:<i> 三段可切）', () => {
    expect(() => generated('a:b', 0)).toThrow(RoleNameError)
    expect(parseRoleName('gen:a:b:0')).toBeNull()
  })

  it('结构 kind 缺半边一律 null（不缺省补默认值）', () => {
    expect(parseRoleName('hole:1')).toBeNull() // 缺 inner
    expect(parseRoleName('hole:1/')).toBeNull() // inner 为空
    expect(parseRoleName('replica[2]')).toBeNull() // 缺 /inner
    expect(parseRoleName('replica[2]/')).toBeNull()
    expect(parseRoleName('replica2/wall:3')).toBeNull() // 少了方括号
    expect(parseRoleName('splinter(top)')).toBeNull() // 缺 #index
    expect(parseRoleName('splinter top)#1')).toBeNull()
    expect(parseRoleName('splinter((top)#1')).toBeNull() // 括号不平衡
    expect(parseRoleName('gen:fillet')).toBeNull()
    expect(parseRoleName('gen:fillet:0:1')).toBeNull()
    expect(parseRoleName('imported')).toBeNull()
    expect(parseRoleName('')).toBeNull()
  })

  it('旧实现的两种串今天都不再合法（盒子前缀 / 位置兜底名）', () => {
    // 这两类正是 Phase 1.7 要淘汰的：名字里塞了 origin（`box:` / `extrude:`）。
    expect(parseRoleName('box:top')).toBeNull()
    expect(parseRoleName('extrude:face_3')).toBeNull()
    expect(parseRoleName('cylinder:lateral')).toBeNull()
  })
})

describe('构造子与 format 契约一致', () => {
  it('构造子产出的串能被 parse 原样读回', () => {
    const built: readonly RoleName[] = [
      semantic('lateral'),
      wall(0),
      hole(1, wall(2)),
      replica(2, hole(1, wall(3))),
      splinter(semantic('top'), 1),
      generated('chamfer', 2),
      imported(5),
    ]
    for (const role of built) {
      expect(parseRoleName(formatRoleName(role))).toEqual(role)
    }
  })
})
