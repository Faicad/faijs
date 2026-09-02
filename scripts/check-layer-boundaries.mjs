#!/usr/bin/env node
/**
 * Layer boundary enforcement (Layered API 方案 D8)
 *
 * Aligns with brepjs scripts/check-layer-boundaries.sh, applied to the ported
 * tree at packages/core/src/vendored/brepjs/ (see §5.2).
 *
 * Run: node scripts/check-layer-boundaries.mjs
 * env override: BOUNDARY_SRC_DIR=<dir>（self-test fixtures）。
 *
 * Rules (matching brepjs: same-layer imports are always allowed — the script
 * only bans *upward* moves; an L0-internal cross-directory edge such as
 * kernel/occtWasm → utils is legal because both live in L0):
 *   R1 导入只向下（target layer ≤ src layer；同层允许，含 L0 内跨目录）。
 *   R2  utils → kernel 反向单射禁止（纯 utils 不依赖内核；若出现再收紧）。
 *   R3 src layer ≥3（L3 api/）+ 禁止直接 import kernel/*（`./primitive` 逃生舱白名单）。
 *   R4 移植树内禁止 import faijs 既有模块：相对导入不逃出移植根；`@/*`、`@faicad/*` 一律禁。
 *      仅 L3 api/ 可有限逃出到 faijs 侧（D10 内核注入）。
 *   R5 反向：faijs 既有代码（vendored 之外）import 移植树只允许发生在 L3 api/。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, dirname, normalize, sep } from 'node:path'

const CORE_ROOT = resolve('packages/core/src')
const VENDORED_ROOT = resolve(process.env.BOUNDARY_SRC_DIR ?? 'packages/core/src/vendored/brepjs')

/** 层 → 顶层目录（相对移植根的目录） */
const LAYERS = [
  ['kernel', 'utils'], // L0
  ['core'], // L1
  // L2
  ['topology', 'operations', '2d', 'query', 'measurement', 'io', 'sketching', 'gear', 'implicit', 'lattice', 'projection'],
  ['api'], // L3
  ['lang', 'cad-runtime', 'module-resolver'], // L4
]

const LAYER_BY_DIR = new Map()
LAYERS.forEach((dirs, layer) => dirs.forEach((d) => LAYER_BY_DIR.set(d, layer)))

/** R3：L3+ 允许直触 kernel 的逃生舱前缀（D7 ./primitive；P1 时按需充实） */
const ALLOWED_KERNEL_PREFIXES = ['primitive']

/** 当前 fixture 存在的顶层目录（动态收集，避免对空目录误判） */
function topDirs(root) {
  if (!existsSync(root)) return new Set()
  return new Set(
    readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  )
}

function layerOf(dir, known) {
  return known.has(dir) ? (LAYER_BY_DIR.get(dir) ?? -1) : -1
}

function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkTs(p, out)
    else if (name.endsWith('.ts') || name.endsWith('.mts')) out.push(p)
  }
  return out
}

function extractImports(code) {
  const out = []
  const re = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(code)) !== null) out.push(m[1])
  return out
}

function escapesRoot(targetAbs) {
  const rel = relative(VENDORED_ROOT, targetAbs)
  return rel === '..' || rel.startsWith('..' + sep)
}

function main() {
  if (!existsSync(VENDORED_ROOT)) {
    console.log(`check-layer-boundaries: 移植根不存在（${VENDORED_ROOT}），跳过（P1 落地前）。`)
    process.exit(0)
  }

  const known = topDirs(VENDORED_ROOT)
  const files = walkTs(VENDORED_ROOT)
  if (files.length === 0) {
    console.log(`check-layer-boundaries: 移植树为空，通过（${VENDORED_ROOT}）。`)
    process.exit(0)
  }

  const errors = []
  let bridgeCount = 0

  // U9 boundary guard (E7, P12): excluded modules must never be ported back in.
  // Assert vendored/brepjs/csg/ never exists and ns/csg.ts is never added
  // (see docs/plans/2026-09-02-faijs-api-surface-completion.md §2.6.1 / E7).
  if (existsSync(join(VENDORED_ROOT, 'csg'))) {
    errors.push('vendored/brepjs/csg/ 目录存在 —— 违反 U9（csg module 从不搬入，§2.6.1）')
  }
  if (existsSync(join(VENDORED_ROOT, 'ns', 'csg.ts'))) {
    errors.push('vendored/brepjs/ns/csg.ts 存在 —— 违反 U9（ns/csg.ts 不搬，§2.6.1/E7）')
  }
  // D10 (P12): quick.ts (auto-assembly convenience) depends on the intentionally
  // unported optionalBackend.ts — never port it back in (§D10 / E7).
  if (existsSync(join(VENDORED_ROOT, 'quick.ts'))) {
    errors.push('vendored/brepjs/quick.ts 存在 —— 违反 D10（依赖未搬的 optionalBackend.ts，P12 E7）')
  }

  for (const file of files) {
    const rel = relative(VENDORED_ROOT, file)
    const srcTop = rel.split(sep)[0] // 文件所在顶层目录（不算子目录）
    const srcLayer = layerOf(srcTop, known)
    // 位于移植根 root 的文件（如 index.ts）或未知顶层目录 → 跳过（brepjs 现状同）
    if (srcLayer < 0) continue

    const code = readFileSync(file, 'utf-8')
    for (const imp of extractImports(code)) {
      // 裸包（flatbush / opentype.js）允许；别名一律禁
      if (!imp.startsWith('.')) {
        if (imp.startsWith('@/') || imp.startsWith('@faicad/')) {
          errors.push(`${rel}: 禁止别名导入 '${imp}'（R4：移植树不允许 faijs alias，用相对路径）`)
        }
        continue
      }

      const targetAbs = normalize(join(dirname(file), imp))

      // R4：逃出移植根 = 触到 faijs 既有侧 → 仅 L3 api/ 允许
      if (escapesRoot(targetAbs)) {
        if (srcTop !== 'api') {
          errors.push(`${rel}: 相对导入 '${imp}' 逃出移植根 → 违反 R4（仅 L3 api/ 可桥接）`)
        } else {
          bridgeCount++
        }
        continue
      }

      const targetRel = relative(VENDORED_ROOT, targetAbs)
      const targetTop = targetRel.split(sep)[0]
      const targetLayer = layerOf(targetTop, known)
      if (targetLayer < 0) continue

      // R3：L3+ 禁直接 import kernel（逃生舱白名单除外）
      if (srcLayer >= 3 && targetTop === 'kernel') {
        const isEscape = ALLOWED_KERNEL_PREFIXES.some((p) =>
          targetRel.split(sep).includes(p),
        )
        if (!isEscape) {
          errors.push(`${rel}: L3+ 直接 import kernel（${imp}）——逃生舱白名单 ${ALLOWED_KERNEL_PREFIXES.join('|')} 之外`)
        }
      }

      // R2：utils → kernel 反向（纯 utils 不得依赖内核）；kernel → utils 允许（occtWasm 即如此）。
      if (srcLayer === 0 && targetLayer === 0 && srcTop === 'utils' && targetTop === 'kernel') {
        errors.push(`${rel}: L0 反向依赖（utils → kernel，R2 禁止）`)
      } else if (targetLayer > srcLayer) {
        errors.push(`${rel}: 向上导入（L${srcLayer}:${srcTop} → L${targetLayer}:${targetTop}）'${imp}'（R1）`)
      }
    }
  }

  // R5 反向：faijs 既有代码（vendored 之外）import 移植树，仅限 L3 api/
  const outside = walkTs(CORE_ROOT).filter(
    (f) => !f.startsWith(join(CORE_ROOT, 'vendored') + sep),
  )
  for (const file of outside) {
    const rel = relative(CORE_ROOT, file)
    if (rel.startsWith('static') || rel.startsWith('node_modules')) continue
    const code = readFileSync(file, 'utf-8')
    for (const imp of extractImports(code)) {
      if (!imp.includes('vendored')) continue
      const inApi = rel.split(sep)[0] === 'api'
      if (!inApi) errors.push(`core/${rel}: 引用移植树（R5 反向——仅 L3 api/ 允许 import vendored）`)
    }
  }

  const unique = [...new Set(errors)]
  if (unique.length > 0) {
    console.error('check-layer-boundaries: 层边界违规：')
    for (const e of unique) console.error(`  ✗ ${e}`)
    console.error('规则：docs/plans/2026-09-01-layered-api-architecture.md §D8')
    process.exit(1)
  }
  console.log(`check-layer-boundaries: 通过（${files.length} 个移植文件${bridgeCount ? `，${bridgeCount} 处 L3 桥接` : ''}）。`)
}

main()