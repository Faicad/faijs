/**
 * Golden 基准：`mate` 约束的旧实现输出冻结（P2-f5 前置 a，《09-07 方案 §2.8 ①-a》）
 *
 * ⚠️ 这组数值是 brepjs 迁移前 faijs 旧实现在 2026-09-07 的产出，旧实现删除后它们就是
 * `mate` 语义的唯一回归基准——改动它们等于改动存量装配行为。
 *
 * 生成方式：删除前用 faijs 旧装配实现（已删）跑下述输入
 * 打印固化（临时脚本 packages/core/scripts/tmp-golden-mate.ts，跑完即弃，不入库）。
 *
 * 比对规则（方案 §2.8 ①-a）：
 * - `rotationMatrix` + `pivot` + `translation`：逐分量 1e-9；
 * - `quaternion`（faijs [x,y,z,w] 序）：按同旋转等价类判定 `|dot(q, q_golden)| ≈ 1`
 *   （G3/E1 的 dot=−1 分支有符号双解，逐分量比会随机红）。
 */

export interface GoldenMateCase {
  /** 用例标签（G1–G4 是 09-06 方案 §4.3 验收数据；E1/E2 是 T4 退化分支补充）。 */
  label: string
  /** fixed face center（world） */
  p1: [number, number, number]
  /** fixed face normal（world） */
  n1: [number, number, number]
  /** moving face center（world） */
  p2: [number, number, number]
  /** moving face normal（world） */
  n2: [number, number, number]
  /** 3x3 旋转矩阵（row-major，9 元） */
  rotationMatrix: number[]
  /** 旋转 pivot（= moving face center，旧实现 `p' = R·(p−pivot)+pivot+translation`） */
  pivot: [number, number, number]
  /** 平移 = fixedCenter − movingCenter（旧实现 `vec3Sub(p1, p2)`） */
  translation: [number, number, number]
  /** 四元数（faijs [x,y,z,w] 序；仅做同旋转等价类判定） */
  quaternion: [number, number, number, number]
}

/**
 * 面贴合 golden 基准用例（G1–G4 面向同向/异向/斜交；E1–E2 面向误差容差）。
 * 每个用例含输入双平面（p/n）与期望解（旋转矩阵、枢轴、平移、四元数），
 * 供约束求解器与自有实现的一致性回归比对（固定快照）。
 */
export const GOLDEN_MATE_CASES: GoldenMateCase[] = [
  {
    label: 'G1',
    p1: [0, 0, 10],
    n1: [0, 0, 1],
    p2: [5, 0, 0],
    n2: [1, 0, 0],
    rotationMatrix: [2.220446049250313e-16, 0, 0.9999999999999998, 0, 1, 0, -0.9999999999999998, 0, 2.220446049250313e-16],
    pivot: [5, 0, 0],
    translation: [-5, 0, 10],
    quaternion: [0, 0.7071067811865475, 0, 0.7071067811865475],
  },
  {
    label: 'G2',
    p1: [0, 0, 10],
    n1: [0, 0, 1],
    p2: [0, 0, 10],
    n2: [0, 0, -1],
    rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    pivot: [0, 0, 10],
    translation: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  },
  {
    label: 'G3',
    p1: [0, 0, 10],
    n1: [0, 0, 1],
    p2: [0, 0, 10],
    n2: [0, 0, 1],
    rotationMatrix: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
    pivot: [0, 0, 10],
    translation: [0, 0, 0],
    quaternion: [0, 1, 0, 0],
  },
  {
    label: 'G4',
    p1: [0, 0, 10],
    n1: [0, 0, 1],
    p2: [0, 0, 10],
    n2: [1, 0, 0],
    rotationMatrix: [2.220446049250313e-16, 0, 0.9999999999999998, 0, 1, 0, -0.9999999999999998, 0, 2.220446049250313e-16],
    pivot: [0, 0, 10],
    translation: [0, 0, 0],
    quaternion: [0, 0.7071067811865475, 0, 0.7071067811865475],
  },
  {
    label: 'E1',
    p1: [0, 0, 0],
    n1: [0, 0, 1],
    p2: [0, 0, 4],
    n2: [0, 0, 1],
    rotationMatrix: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
    pivot: [0, 0, 4],
    translation: [0, 0, -4],
    quaternion: [0, 1, 0, 0],
  },
  {
    label: 'E2',
    p1: [0, 0, 0],
    n1: [0, 0, 1],
    p2: [1, 2, 3],
    n2: [0, 1, 0],
    rotationMatrix: [1, 0, 0, 0, 2.220446049250313e-16, 0.9999999999999998, 0, -0.9999999999999998, 2.220446049250313e-16],
    pivot: [1, 2, 3],
    translation: [-1, -2, -3],
    quaternion: [-0.7071067811865475, 0, 0, 0.7071067811865475],
  },
]

/**
 * 按标签取一个 golden 用例；未知标签抛错（防测试里 typos 静默跳过）。
 *
 * @param label - 用例标签（G1–G4 / E1–E2）。
 * @returns 匹配的 golden 用例对象。
 * @throws Error 未知标签。
 */
export function goldenMateCase(label: string): GoldenMateCase {
  const found = GOLDEN_MATE_CASES.find((c) => c.label === label)
  if (!found) throw new Error(`golden-mate: unknown case "${label}"`)
  return found
}