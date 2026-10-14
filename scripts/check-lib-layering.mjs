/**
 * check-lib-layering — 库分层静态门禁（2026-10-14 全仓化，内核取用面收敛 §3.4）
 *
 * 判据来源是**库自身的定位声明**：`package.json` 的 `faijs.lib.role`（§3.3 第 1 项）。
 * 不再硬编码某个包名，也不再维护文件白名单。
 *
 * 扫描范围：`packages/*` 下全部**非 private** 的 `@faicad/*` 包（private 的
 * demo / fixtures / tests 不是交付物，不参与），每包扫 `src/` 与 `scripts/`。
 *
 * 角色语义（`role` 缺省 = `library` = 最严）：
 *   - `library` / `declaration`：走下面的代码规则集。`declaration` 再加一条
 *     「什么都不取」——数据/声明库不得出现任何内核符号。
 *   - `host` / `adapter`：按声明放行，代码规则集不适用（宿主/引擎本来就要启动内核、
 *     读槽位、装配引擎）。
 *
 * 代码规则（仅 `library` / `declaration`）：
 *  1. `occt-wasm-import`  禁止 import `occt-wasm` / `brepkit-wasm`（含 `import type`
 *     与动态 import）——内核由宿主注入。该条同时覆盖旧规则里单独的 `OcctKernel`
 *     类型 import 检查。
 *  2. `kernel-bootstrap`  禁止 `initOcctWasm` / `setOcctWasmInitFn` / `initBrepkitWasm`
 *     / `setBrepkitWasmInitFn`。唯一例外：库自己的 `src/test-setup.ts`（测试装配）。
 *  3. `cross-lib-internals` 禁止 `getGearKernel`——不得消费另一个第三方库的内部入口。
 *  4. `raw-kernel-slot`   禁止 `getBackends`（不留文件白名单）：要取内核走
 *     `getBrepApi()` / `getOcctKernel()` / `getBrepKitKernel()`。
 *  5. `as-any`            禁止 `as any`。
 *  6. `kernel-face-recast` 禁止跨内核面的 `as unknown as`：`getBrepApi() as unknown as …`
 *     或 `as unknown as BrepEngineApi|OcctKernel|BrepKitKernel`。原始槽位那条腿由规则 4
 *     覆盖；本规则管「经 L1 面再断言成平台面」那条腿（2026-10-14 新增）。
 *  7. `declaration-takes-nothing`（仅 `declaration`）禁止 `getBrepApi` / `getOcctKernel`
 *     / `getBrepKitKernel` / `occt-kernel/` / `brepkit-kernel/`。
 *
 * 声明规则（全部角色，读 `package.json`）：
 *  P1 `platform-peer`       `faijs.lib.platform` 含 `occt` ⟹ 必须有 `occt-wasm` peer。
 *  P2 `platform-engines`    `platform` 的元素必须是合法引擎 id。
 *  P3 `role-known`          `role` 必须是 `library` / `host` / `declaration` / `adapter`。
 *
 * 命中任一规则即退出码 1（CI 红）。
 *
 * 用法：node scripts/check-lib-layering.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(repoRoot, 'packages')

/** 与 `packages/core/src/brep/engine/types.ts` 的 `BREP_ENGINE_IDS` 同源。 */
const BREP_ENGINE_IDS = ['occt', 'brepkit', 'brep_mock']
const LIB_ROLES = ['library', 'host', 'declaration', 'adapter']
/** 按库代码规则集检查的角色；其余角色按声明放行。 */
const LIBRARY_ROLES = new Set(['library', 'declaration'])
/** 允许自装配内核的测试文件（相对包根，POSIX 斜杠）。 */
const BOOTSTRAP_EXEMPT = ['src/test-setup.ts']

const CODE_RULES = [
  {
    id: 'occt-wasm-import',
    re: /from\s+['"](?:occt|brepkit)-wasm['"]|import\s*\(\s*['"](?:occt|brepkit)-wasm['"]\s*\)/,
    msg: "不得 import 'occt-wasm' / 'brepkit-wasm'（内核须经宿主注入）",
  },
  {
    id: 'kernel-bootstrap',
    re: /\b(?:initOcctWasm|setOcctWasmInitFn|initBrepkitWasm|setBrepkitWasmInitFn)\b/,
    msg: '不得自装配内核（仅 src/test-setup.ts 例外）',
  },
  {
    id: 'cross-lib-internals',
    re: /\bgetGearKernel\b/,
    msg: '不得消费另一个第三方库的内部入口（getGearKernel）',
  },
  {
    id: 'raw-kernel-slot',
    re: /\bgetBackends\b/,
    msg: '不得读裸内核槽位；走 getBrepApi() / getOcctKernel() / getBrepKitKernel()',
  },
  {
    id: 'as-any',
    re: /\bas\s+any\b/,
    msg: '禁止 as any',
  },
  {
    id: 'kernel-face-recast',
    // 精确化，不做「一刀切禁 as unknown as」：只有**跨越内核面**的假断言才是事故
    // （`gears.ts` 把 L1 槽位断言成「L1 + 15 个 occt 扩展」的并集，缺的方法只在构建
    // 深处以 `kernel.X is not a function` 爆出）。库自家子集类型（如 fasteners 的
    // `WarehouseKernel`）与脚本面无关的类型转换不是内核面跨越，不在此列。
    // 原始槽位那条腿由 `raw-kernel-slot`（禁 getBackends）覆盖；本规则管经 L1 面
    // 再断言成平台面的那条腿。
    re: /getBrepApi\s*\(\s*\)\s*as\s+unknown\s+as\b|\bas\s+unknown\s+as\s+(?:BrepEngineApi|OcctKernel|BrepKitKernel)\b/,
    msg: '不得用 as unknown as 跨越内核面（把 L1 面/槽位再断言成平台面）；平台能力走 getOcctKernel() / getBrepKitKernel()',
  },
]

/** `declaration` 角色附加规则：数据/声明库不得出现任何内核符号。 */
const DECLARATION_RULES = [
  {
    id: 'declaration-takes-nothing',
    re: /\b(?:getBrepApi|getOcctKernel|getBrepKitKernel|getBrepEngine|getActiveBrepEngine)\b|(?:occt|brepkit)-kernel\//,
    msg: '数据/声明库不得出现任何内核符号',
  },
]

/** 剥掉块注释/行注释/字符串字面量，避免文档性提及误报。 */
function stripCommentsAndStrings(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replaceAll(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replaceAll(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replaceAll(/[^\n]/g, ' '))
}

function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__pycache__') continue
      collectFiles(full, out)
    } else if (/\.(ts|mts|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 读包策略：`faijs.lib` 的 role / platform，缺省 role = library（最严）。 */
function readPolicy(pkgDir) {
  const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'))
  const lib = pj.faijs?.lib
  if (lib !== undefined && (typeof lib !== 'object' || lib === null || Array.isArray(lib))) {
    return { packageName: pj.name, error: `faijs.lib 必须是对象，实为 ${Array.isArray(lib) ? 'array' : typeof lib}`, pj, lib: undefined }
  }
  return {
    packageName: pj.name,
    pj,
    lib,
    role: lib?.role ?? 'library',
    platform: Array.isArray(lib?.platform) ? lib.platform : [],
  }
}

const violations = []
const checked = []

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgDir = join(packagesDir, entry.name)
  if (!existsSync(join(pkgDir, 'package.json'))) continue

  const policy = readPolicy(pkgDir)
  const where = policy.packageName ?? entry.name
  if (policy.error) {
    violations.push(`packages/${entry.name}: [lib-decl-shape] ${policy.error}`)
    continue
  }
  if (policy.pj.private === true) continue
  if (!String(where).startsWith('@faicad/')) continue

  // ── 声明规则（全部角色）──
  if (!LIB_ROLES.includes(policy.role)) {
    violations.push(
      `packages/${entry.name}: [role-known] faijs.lib.role 必须是 ${LIB_ROLES.join(' / ')}，实为 ${JSON.stringify(policy.role)}`,
    )
  }
  for (const id of policy.platform) {
    if (!BREP_ENGINE_IDS.includes(id)) {
      violations.push(
        `packages/${entry.name}: [platform-engines] faijs.lib.platform 含未知引擎 id ${JSON.stringify(id)}（合法值：${BREP_ENGINE_IDS.join(' / ')}）`,
      )
    }
  }
  if (policy.platform.includes('occt') && policy.pj.peerDependencies?.['occt-wasm'] === undefined) {
    violations.push(
      `packages/${entry.name}: [platform-peer] faijs.lib.platform 含 'occt'，但包没有 'occt-wasm' peerDependency`,
    )
  }

  checked.push(`${where} (role=${policy.role}${policy.platform.length ? `, platform=[${policy.platform.join('/')}]` : ''})`)

  // ── 代码规则（仅 library / declaration）──
  if (!LIBRARY_ROLES.has(policy.role)) continue
  const rules = policy.role === 'declaration' ? [...CODE_RULES, ...DECLARATION_RULES] : CODE_RULES
  for (const scope of ['src', 'scripts']) {
    for (const file of collectFiles(join(pkgDir, scope))) {
      const rel = relative(pkgDir, file).replaceAll('\\', '/')
      const code = stripCommentsAndStrings(readFileSync(file, 'utf-8'))
      for (const rule of rules) {
        if (rule.id === 'kernel-bootstrap' && BOOTSTRAP_EXEMPT.includes(rel)) continue
        if (rule.re.test(code)) {
          violations.push(`packages/${entry.name}/${rel}: [${rule.id}] ${rule.msg}`)
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`[check-lib-layering] FAIL — ${violations.length} 处违规：`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`[check-lib-layering] OK — ${checked.length} 个包通过：`)
for (const c of checked) console.log(`  - ${c}`)
