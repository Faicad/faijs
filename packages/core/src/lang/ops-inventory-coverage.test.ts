/**
 * ops-inventory-coverage — 手册逐 op 章节覆盖守卫（B1）
 *
 * `docs/ops-api-inventory.md` / `.zh.md` 是 `cad.*` 脚本面的对外手册。B1 的实测
 * 结论是：手册逐 op 章节只覆盖 57 个符号，而 `lang/symbol-table.generated.ts`
 * （= `cad` 命名空间可调用键集 = 脚本面真实 op 全集）有 95 键——**38 个 op 在手册
 * 里根本不存在**，其中 `applyMatrix`（等价 OpenSCAD `multmatrix` 的任意仿射变换）
 * 的缺席直接让下游误判「faijs 不具备任意仿射能力」。
 *
 * 两类根因，本测试各钉一条（都在**已提交产物**上判定，不走生成器的内存模型）：
 *   ① 逐 op 章节符号集 ≠ 符号表键集（缺章 / 幽灵章 / 重名章）；
 *   ② 某种 `@group` 值不在生成器分组表里 → 整组静默消失（`修复` 组 6 个 op
 *      就是这样丢的）。
 *
 * 与 `scripts/gen-ops-api-inventory.ts` 内的生成期断言互补：那边判「我打算写的
 * 内容是否完整」，这边判「仓库里躺着的内容是否完整」。手改 md、只更新符号表而
 * 忘了重生成手册，都会在这里失败。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import SYMBOL_TABLE from './symbol-table.generated'

/** 从手册文本里取出逐 op 章节名（`### 3.18 \`torus\` ✅` → `torus`）。 */
function chapterNamesFrom(text: string): string[] {
  const names: string[] = []
  const re = /^### \d+\.\d+ `([A-Za-z_][A-Za-z0-9_]*)`/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) names.push(m[1])
  return names
}

/** 从手册文本里取出分节分组名（`## 6. 修复类操作（inputs ≥ 1）` → `修复`）。 */
function sectionGroupsFrom(text: string): Set<string> {
  const groups = new Set<string>()
  const re = /^## \d+\. (\S+?)类操作/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) groups.add(m[1])
  return groups
}

/** 章节覆盖的双向差集（缺章 / 幽灵章）。 */
function coverageGap(chapters: string[], symbolKeys: string[]): { missing: string[]; ghosts: string[] } {
  const covered = new Set(chapters)
  const keys = new Set(symbolKeys)
  return {
    missing: symbolKeys.filter((k) => !covered.has(k)).sort(),
    ghosts: [...covered].filter((c) => !keys.has(c)).sort(),
  }
}

/** 手册与 api 源码的仓库内位置（本文件在 packages/core/src/lang/）。 */
const repoUrl = (rel: string): URL => new URL(`../../../../${rel}`, import.meta.url)
const API_SRC = fileURLToPath(repoUrl('packages/core/src/api'))

function manualText(rel: string): string {
  return readFileSync(fileURLToPath(repoUrl(rel)), 'utf8')
}

function chapterNames(rel: string): string[] {
  return chapterNamesFrom(manualText(rel))
}

function sectionGroups(rel: string): Set<string> {
  return sectionGroupsFrom(manualText(rel))
}

/** 递归收集 api/ 下全部源码（与生成器同一口径：排除 *.test.ts）。 */
function apiSources(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) apiSources(p, out)
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

/** 全部手写 op 声明的 `@group` 值。 */
function declaredGroups(): Set<string> {
  const groups = new Set<string>()
  for (const file of apiSources(API_SRC)) {
    const text = readFileSync(file, 'utf8')
    const re = /^\s*\*?\s*@group\s+(\S+)\s*$/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) groups.add(m[1])
  }
  return groups
}

const SYMBOL_KEYS = Object.keys(SYMBOL_TABLE)

describe('ops-inventory-coverage: 手册逐 op 章节 ≡ 符号表键集（B1）', () => {
  it('符号表非空（守卫本身不可空转）', () => {
    expect(SYMBOL_KEYS.length).toBeGreaterThan(0)
  })

  it('判定逻辑不自证清白：缺章与幽灵章都能被检出', () => {
    const text = [
      '## 3. 创建类操作（无上游输入）',
      '',
      '### 3.1 `box` ✅',
      '',
      '### 3.2 `torus` ✅',
      '',
      '## 4. 变换类操作（inputs ≥ 1）',
      '',
      '### 4.1 `ghost` ✅',
      '',
    ].join('\n')
    const names = chapterNamesFrom(text)
    expect(names).toEqual(['box', 'torus', 'ghost'])
    expect(sectionGroupsFrom(text)).toEqual(new Set(['创建', '变换']))
    // box/torus 在表内且成章；volume 在表内但缺章；ghost 有章但不在表内
    expect(coverageGap(names, ['box', 'torus', 'volume'])).toEqual({ missing: ['volume'], ghosts: ['ghost'] })
    expect(coverageGap(names, ['box', 'torus', 'ghost'])).toEqual({ missing: [], ghosts: [] })
  })

  for (const rel of ['docs/ops-api-inventory.md', 'docs/ops-api-inventory.zh.md']) {
    it(`${rel}：逐 op 章节符号集双向等于符号表键集`, () => {
      const names = chapterNames(rel)
      expect(names.length).toBeGreaterThan(0)
      expect(coverageGap(names, SYMBOL_KEYS)).toEqual({ missing: [], ghosts: [] })
    })

    it(`${rel}：无重名章节（章节数 == 覆盖的符号数）`, () => {
      const names = chapterNames(rel)
      expect(new Set(names).size).toBe(names.length)
      expect(names.length).toBe(SYMBOL_KEYS.length)
    })
  }

  it('双语手册覆盖同一符号集（成对产物不漂移）', () => {
    const en = chapterNames('docs/ops-api-inventory.md').sort()
    const zh = chapterNames('docs/ops-api-inventory.zh.md').sort()
    expect(zh).toEqual(en)
  })

  it('手写 op 声明的每个 @group 都在手册里有对应分节（整组不静默消失）', () => {
    const groups = declaredGroups()
    expect(groups.size).toBeGreaterThan(0)
    for (const rel of ['docs/ops-api-inventory.md', 'docs/ops-api-inventory.zh.md']) {
      const sections = sectionGroups(rel)
      const dropped = [...groups].filter((g) => !sections.has(g)).sort()
      expect(dropped, `${rel} 缺少 @group 分节`).toEqual([])
    }
  })
})
