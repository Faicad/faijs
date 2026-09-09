/**
 * parity-smoke.test.ts — 阶段 D（P5 收尾）：smoke fixture 入 vitest。
 *
 * 从 parity 比对的稳定 PASS 用例中挑 30 个代表性 case，把 ref STEP 入库到
 * `tests/fixtures/ref/`；本测试对每个 case：
 *   1. 经 faijs-cli 执行镜像脚本导出候选 STEP（复用 run-cand 的调用方式）；
 *   2. 用 `compareStepFiles`（复用 `src/step-compare.ts`，不另写比对器）与
 *      入库 ref STEP 比对，断言几何等价（PASS 判据与 compare.ts 相同）。
 *
 * 全量（650 case）比对仍走本地 `tests/compare.ts`，不进 CI（原方案 §8 取舍）。
 * 入库 fixture 是不可变基线：更新必须重跑 ref-harness 并重新拷贝。
 *
 * @module
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, it, expect } from 'vitest'
import { compareStepFiles } from './step-compare.ts'

const execFileAsync = promisify(execFile)

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const REPO = join(PKG, '..', '..')
const CLI = join(REPO, 'packages', 'core', 'scripts', 'faijs-cli.ts')
const OUT_SMOKE = join(PKG, 'out', 'smoke')
const FIXTURES = join(PKG, 'tests', 'fixtures', 'ref')

/** Windows 下 spawnSync 解析不了无扩展名的 npx shim —— 经 shell 路由。 */
const IS_WIN = process.platform === 'win32'

interface SmokeCase {
  /** 镜像脚本所在模块目录（tests/ 下）。 */
  moduleDir: string
  /** 镜像脚本名（不含 .fai.js），也是导出 STEP 的基名。 */
  name: string
  /** 入库 ref fixture 文件名（tests/fixtures/ref/ 下）。 */
  refFile: string
}

const CASES: SmokeCase[] = [
  // ── test_cadquery：原语 / boolean / 倒角 / 拉伸切除 / loft / revolve ──
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testBoxDefaults__s', refFile: 'tests.test_cadquery__TestCadQuery__testBoxDefaults__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testBoxPointList__s', refFile: 'tests.test_cadquery__TestCadQuery__testBoxPointList__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCylinderDefaults__s', refFile: 'tests.test_cadquery__TestCadQuery__testCylinderDefaults__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCylinderCenteringAndDirection__s', refFile: 'tests.test_cadquery__TestCadQuery__testCylinderCenteringAndDirection__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testChamfer__cube', refFile: 'tests.test_cadquery__TestCadQuery__testChamfer__cube.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testChamferCylinder__cylinder', refFile: 'tests.test_cadquery__TestCadQuery__testChamferCylinder__cylinder.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCut__sugar', refFile: 'tests.test_cadquery__TestCadQuery__testCut__sugar.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCutThroughAll__r', refFile: 'tests.test_cadquery__TestCadQuery__testCutThroughAll__r.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testAngledHoles__s', refFile: 'tests.test_cadquery__TestCadQuery__testAngledHoles__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCounterBores__c', refFile: 'tests.test_cadquery__TestCadQuery__testCounterBores__c.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCounterSinks__result', refFile: 'tests.test_cadquery__TestCadQuery__testCounterSinks__result.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCup__s1', refFile: 'tests.test_cadquery__TestCadQuery__testCup__s1.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCombine__objects1', refFile: 'tests.test_cadquery__TestCadQuery__testCombine__objects1.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testCombine__objects2', refFile: 'tests.test_cadquery__TestCadQuery__testCombine__objects2.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testBoxCombine__s', refFile: 'tests.test_cadquery__TestCadQuery__testBoxCombine__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testTopFaceFillet__s', refFile: 'tests.test_cadquery__TestCadQuery__testTopFaceFillet__s.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testRevolveCut__box', refFile: 'tests.test_cadquery__TestCadQuery__testRevolveCut__box.step' },
  { moduleDir: 'test_cadquery', name: 'TestCadQuery__testTwistedLoft__s', refFile: 'tests.test_cadquery__TestCadQuery__testTwistedLoft__s.step' },
  // ── test_selectors：边 compound（STEP 导出 edge 分派锚点）──
  { moduleDir: 'test_selectors', name: 'TestCQSelectors__testShape__res4', refFile: 'tests.test_selectors__TestCQSelectors__testShape__res4.step' },
  // ── test_shapes：Shape 域自由函数 ──
  { moduleDir: 'test_shapes', name: 'test_isSolid__s', refFile: 'tests.test_shapes___test_isSolid__s.step' },
  { moduleDir: 'test_shapes', name: 'test_shells__s', refFile: 'tests.test_shapes___test_shells__s.step' },
  // ── test_free_functions：自由函数原语（直径参数）/ moved / extrude both / compound ──
  { moduleDir: 'test_free_functions', name: 'test_box__s', refFile: 'tests.test_free_functions___test_box__s.step' },
  { moduleDir: 'test_free_functions', name: 'test_cylinder__s', refFile: 'tests.test_free_functions___test_cylinder__s.step' },
  { moduleDir: 'test_free_functions', name: 'test_sphere__s', refFile: 'tests.test_free_functions___test_sphere__s.step' },
  { moduleDir: 'test_free_functions', name: 'test_torus__s', refFile: 'tests.test_free_functions___test_torus__s.step' },
  { moduleDir: 'test_free_functions', name: 'test_cone__s', refFile: 'tests.test_free_functions___test_cone__s.step' },
  { moduleDir: 'test_free_functions', name: 'test_moved__b', refFile: 'tests.test_free_functions___test_moved__b.step' },
  { moduleDir: 'test_free_functions', name: 'test_extrude__r5', refFile: 'tests.test_free_functions___test_extrude__r5.step' },
  { moduleDir: 'test_free_functions', name: 'test_history_bool__res2', refFile: 'tests.test_free_functions___test_history_bool__res2.step' },
  // ── test_workplanes：mirror op 锚点 ──
  { moduleDir: 'test_workplanes', name: 'TestWorkplanes__test_mirror__b2', refFile: 'tests.test_workplanes__TestWorkplanes__test_mirror__b2.step' },
]

/** 导出候选 STEP（多导出变量时 CLI 产生 `<name>.step_N_<var>.step`，取第一个）。 */
async function exportCandStep(mirror: string, outBase: string): Promise<string> {
  // 异步 spawn：同步 execFile 会阻塞 vitest worker 的 RPC 心跳（onTaskUpdate 超时）。
  await execFileAsync(
    'npx',
    ['tsx', CLI, 'run', mirror, '--out', outBase, '--mode', 'brep'],
    { cwd: REPO, shell: IS_WIN, maxBuffer: 16 * 1024 * 1024 },
  )
  const dir = dirname(outBase)
  const base = outBase.slice(dir.length + 1)
  const produced = readdirSync(dir).filter((f) => f === base || f.startsWith(`${base}_`)).sort()
  if (produced.length === 0) throw new Error(`cli produced no STEP for ${mirror}`)
  return join(dir, produced[0])
}

/**
 * 与 tests/compare.ts 的 PASS 判据保持一致（宽松拓扑、1e-3 线性/体积容差、
 * 0.1mm³ 布尔差容差）—— smoke 断言的就是全量比对的 PASS 口径。
 */
const COMPARE_OPTIONS = {
  strictTopology: false,
  linearTolerance: 1e-3,
  volumeRelativeTolerance: 1e-3,
  booleanVolumeTolerance: 0.1,
} as const

describe('parity smoke (阶段 D：30 个稳定 PASS 用例 vs 入库 ref fixture)', () => {
  it('fixture 清单完整（30 个 ref STEP 已入库）', () => {
    expect(CASES).toHaveLength(30)
    for (const c of CASES) {
      expect(readdirSync(FIXTURES), `missing fixture ${c.refFile}`).toContain(c.refFile)
    }
  })

  for (const c of CASES) {
    it(c.name, async () => {
      mkdirSync(OUT_SMOKE, { recursive: true })
      const mirror = join(PKG, 'tests', c.moduleDir, `${c.name}.fai.js`)
      const outBase = join(OUT_SMOKE, `${c.name}.step`)
      const candStep = await exportCandStep(mirror, outBase)
      const result = await compareStepFiles(candStep, join(FIXTURES, c.refFile), COMPARE_OPTIONS)
      const summary = {
        bbox: result.bbox.maxDiff,
        volPct: result.volume.diffPct,
        com: result.centerOfMass.maxDiff,
        topology: result.topology,
        booleanDiff: [result.booleanDiff.aMinusB.volume, result.booleanDiff.bMinusA.volume],
      }
      expect(result.equivalent, `${c.name}: ${JSON.stringify(summary)}`).toBe(true)
    }, 120_000)
  }
})
