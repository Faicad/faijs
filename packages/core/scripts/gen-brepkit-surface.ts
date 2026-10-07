/**
 * gen-brepkit-surface — brepkit-wasm 导出面盘点（Phase 0 工件生成器）
 *
 * 输入：npm 包 brepkit-wasm 的 brepkit_wasm.d.ts（开发依赖，见 packages/core/package.json
 *       devDependencies；未安装时本脚本明确报错——wasm 导出面是 Phase 2 接线的
 *       事实基线，不允许在缺包时静默产出空表）。
 * 产物：api/surface/brepkit-wasm-surface.json（入库，符号清单）
 *
 * 口径：methods = d.ts 顶层类方法名（正则 `^\s+<name>(`，含 constructor）。
 *       与 brepkit-kernel/brepkitKernel.ts 的接线对照由断言测试钉住。
 *
 * 运行：npx tsx packages/core/scripts/gen-brepkit-surface.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const OUT_FILE = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'brepkit-wasm-surface.json')

function main(): void {
  const require = createRequire(import.meta.url)
  let entryPath: string
  let pkg: { name: string; version: string }
  try {
    entryPath = require.resolve('brepkit-wasm')
    // 从入口向上找 package.json（入口可能是 dist 文件）
    let dir = path.dirname(entryPath)
    let pkgPath: string | null = null
    for (let i = 0; i < 6; i++) {
      const cand = path.join(dir, 'package.json')
      if (fs.existsSync(cand)) {
        pkgPath = cand
        break
      }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    if (!pkgPath) throw new Error('package.json not found above entry')
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name: string; version: string }
  } catch {
    throw new Error(
      '[gen-brepkit-surface] brepkit-wasm 未安装（packages/core devDependencies 应有它）。' +
        'wasm 导出面是 Phase 2 接线的事实基线，缺包时禁止产出空表——请先 npm install。',
    )
  }
  const pkgDir = path.dirname(entryPath)
  let dtsPath = path.join(pkgDir, 'brepkit_wasm.d.ts')
  if (!fs.existsSync(dtsPath)) {
    // 兜底：从包根递归找 *.d.ts（包结构可能变化）
    const found = findDts(path.dirname(pkgDir))
    if (!found) throw new Error(`[gen-brepkit-surface] 找不到 brepkit_wasm.d.ts（${pkgDir}）`)
    dtsPath = found
  }
  const dts = fs.readFileSync(dtsPath, 'utf-8')

  const methods = new Set<string>()
  for (const m of dts.matchAll(/^\s+(\w+)\s*\(/gm)) methods.add(m[1])

  // brepkit 适配器（brepkitKernel.ts）中 unsupported 桩的方法白名单：从源码提取
  // （`unsupported('<name>', …)`），保证盘点表与适配器实际声明面一致。
  const kernelSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'brepkit-kernel', 'brepkitKernel.ts'),
    'utf-8',
  )
  const unsupportedWhitelist = new Set<string>()
  for (const m of kernelSrc.matchAll(/unsupported\s*\(\s*['"]([^'"]+)['"]/g)) {
    unsupportedWhitelist.add(m[1])
  }

  // 关键族归类（供人工/断言快速对照；全量清单以 methods 为准）
  const patternMethods = ['linearPattern', 'circularPattern', 'gridPattern', 'rectangularPattern']
    .filter((m) => methods.has(m))
  const transformMethods = ['mirror', 'rotate', 'translate', 'scale', 'transformSolid', 'composeTransforms']
    .filter((m) => methods.has(m))
  const evolutionMethods = [...methods].filter((m) => /WithEvolution|WithHistory$/.test(m)).sort()
  /** wasm 已导出、但 brepkit 适配器仍是 unsupported 桩的方法（Phase 2/3 接线候选）。 */
  const wasmExportedButUnwired = [...unsupportedWhitelist].filter((m) => methods.has(m)).sort()
  /** wasm 确实未导出的白名单方法（保持 unsupported 且能力表不声明的依据）。 */
  const notExported = [...unsupportedWhitelist].filter((m) => !methods.has(m)).sort()

  const out = {
    generatedBy: 'packages/core/scripts/gen-brepkit-surface.ts',
    package: pkg.name,
    version: pkg.version,
    dtsFile: path.relative(process.cwd(), dtsPath).replace(/\\/g, '/'),
    methodCount: methods.size,
    methods: [...methods].sort(),
    patternMethods,
    transformMethods,
    evolutionMethods,
    /** wasm 已导出、但 brepkit 适配器 v1 仍是 unsupported 桩的方法（Phase 2/3 接线候选）。 */
    wasmExportedButUnwired,
    /** wasm 确实未导出的白名单方法（保持 unsupported 且能力表不声明的依据）。 */
    notExported,
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf-8')
  console.log(`[gen-brepkit-surface] ${pkg.name}@${pkg.version}: ${methods.size} methods -> ${path.relative(process.cwd(), OUT_FILE)}`)
}

function findDts(dir: string): string | null {
  const stack = [dir]
  while (stack.length > 0) {
    const d = stack.pop()!
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name.endsWith('.d.ts')) return p
    }
  }
  return null
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
