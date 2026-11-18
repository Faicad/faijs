/**
 * api/pmi/affine — PMI 裸世界坐标的累积变换（消费端施加，数据零改动）
 *
 * ## 解决什么
 *
 * `PmiLocalNote.anchor` / `PmiLocalNote.leaderDirection` / `PmiThreadHole.axis` 是**裸世界
 * 坐标**——它们不在 `TopoRef` 体系里（mesh 链没有拓扑身份，也必须能定位孔口）。
 * 而 `TopoRef` 的坐标是"语句级因果坐标"，`translate` / `rotate` / `scale` 之后
 * 自己就能解析到新位置；裸坐标不会。
 *
 * 所以 `box → 钻孔 → translate(+100,0,0)` 之后，孔的标注仍留在原位。修法有两种：
 *
 * 1. **写数据时跟着变**——`translate` 的实现把上游每条标注的坐标改一遍；
 * 2. **读数据时施加累积变换**——数据一个字节不动，聚合时按父语句链把矩阵乘上去。
 *
 * 本模块实现第 2 种。为什么：数据是唯一真源，一旦允许"某个 op 顺手改上游标注"，
 * 就回到了逐个 op 搬运的老路（漏一个就是静默错误）；而且变换链一旦叠加，改写
 * 会把历史坐标永久污染，改参重放（重放整段脚本）时也看不出原始标注是什么。
 *
 * ## 模型
 *
 * 每条语句可以带一个仿射矩阵 `T`，含义是"这条语句把输入几何变换成了产物"：
 * `p_产物 = T · p_输入`。聚合沿父链回溯时维护累积矩阵 `M`（从当前语句的坐标系
 * 看向祖先的坐标系），每上一级 `M ← M ∘ T_父`。写在祖先语句名下的标注用 `M`
 * 重映射，写在当前语句名下的用 `I`。
 *
 * 只有变换类 op 会登记 `T`（`translate` / `rotate_euler` / `scale` / `scale3d`，
 * 见 `api/transform.ts` 的 `pmiRemap` 声明）。其余 op 不登记 = `T = I`，链上
 * 自然是"坐标不动"。`subtract` / `union` 这类布尔 op 虽然会动面，但**不动坐标系**
 * ——它们不登记，正是这个原因。
 *
 * ## 已知边界
 *
 * 登记发生在 `defineOp.wrapped` 的**最外层**（`isOuter`）：嵌套调用不登记。所以
 * 若将来有某个 op 在自己实现里再调 `translate`（目前没有——`extra/ops/text.ts`
 * 用的是 L1 `kernel.translate` 直接改构造期的实体，与语句坐标系无关），那条
 * 语句的变换就不会被登记，其上游的裸坐标标注不会跟着走。新增这类 op 时要么把
 * 位移折进自己的 `pmiRemap`，要么直接调 L1。
 *
 * `mirror` 已支持（#15，plan 2026-11-07）：手写 override（`api/replicate.ts`，
 * 非生成文件）经 `pmiRemap` 登记 `mirrorAffine`（det=−1，见下）。`mirrorJoin`
 * **不**登记——它的原物（replica[0]）坐标系未动，登记反而会把原物的标注搬走；
 * 镜像副本的标注复制是另一个机制（标注复制，不是坐标补偿）。
 *
 * ## 布局
 *
 * 3×4 行主序（`[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]`），与
 * `brep/brep-ops.ts#matrixToArray`（喂给 `kernel.transform`）逐位一致——旋转矩阵
 * 直接取 `math3d` 的 `Mat4.makeRotationFromEuler`，与 mesh 链 / brep 链用的是
 * **同一个** `Euler`/`Mat4` 实现，因此不存在"补偿矩阵和真实几何差一个转序"的风险。
 */

import { Euler, Mat4 } from '../../math3d'
import type { PmiItem } from './types'

type V3 = [number, number, number]

/** 3×4 行主序仿射矩阵（12 个数；布局见文件头）。 */
export type PmiAffine = readonly number[]

/** 恒等变换。 */
export const PMI_AFFINE_IDENTITY: PmiAffine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/**
 * 是否恒等（容差 1e-12，只用来省掉一次重映射，不承担几何判定）。
 * @param a - the affine matrix.
 * @returns true when the matrix is the identity.
 */
export function isIdentityAffine(a: PmiAffine): boolean {
  for (let i = 0; i < 12; i += 1) {
    if (Math.abs(a[i] - PMI_AFFINE_IDENTITY[i]) > 1e-12) return false
  }
  return true
}

/**
 * 点变换：`p' = R·p + t`。
 * @param a - the affine matrix.
 * @param p - the point to transform.
 * @returns the transformed point.
 */
export function affineApplyPoint(a: PmiAffine, p: V3): V3 {
  return [
    a[0] * p[0] + a[1] * p[1] + a[2] * p[2] + a[3],
    a[4] * p[0] + a[5] * p[1] + a[6] * p[2] + a[7],
    a[8] * p[0] + a[9] * p[1] + a[10] * p[2] + a[11],
  ]
}

/**
 * 方向变换：乘线性部分再归一化。
 *
 * 为什么不是法向的逆转置：这里用到方向的两个字段——`PmiThreadHole.axis.direction`
 * 与 `PmiLocalNote.leaderDirection`——都是**线的方向**（切向），不是面法向。线的方向
 * 在仿射下按线性部分变换（非等比缩放下孔轴仍是 `R·d` 方向，只是孔变成椭圆），
 * 法向才需要逆转置。用错了会在 `scale3d` 之后把孔轴方向算歪。
 *
 * @param a - the affine matrix.
 * @param d - the direction to transform (not necessarily unit length).
 * @returns the transformed unit direction.
 */
export function affineApplyDirection(a: PmiAffine, d: V3): V3 {
  const x = a[0] * d[0] + a[1] * d[1] + a[2] * d[2]
  const y = a[4] * d[0] + a[5] * d[1] + a[6] * d[2]
  const z = a[8] * d[0] + a[9] * d[1] + a[10] * d[2]
  const len = Math.hypot(x, y, z)
  return len < 1e-12 ? [0, 0, 0] : [x / len, y / len, z / len]
}

/**
 * 合成：`outer ∘ inner`（先 `inner` 后 `outer`）。
 * @param outer - the transform applied second.
 * @param inner - the transform applied first.
 * @returns the composed matrix.
 */
export function composeAffine(outer: PmiAffine, inner: PmiAffine): PmiAffine {
  const r: number[] = []
  for (let row = 0; row < 3; row += 1) {
    const o0 = outer[row * 4]
    const o1 = outer[row * 4 + 1]
    const o2 = outer[row * 4 + 2]
    const o3 = outer[row * 4 + 3]
    r.push(
      o0 * inner[0] + o1 * inner[4] + o2 * inner[8],
      o0 * inner[1] + o1 * inner[5] + o2 * inner[9],
      o0 * inner[2] + o1 * inner[6] + o2 * inner[10],
      o0 * inner[3] + o1 * inner[7] + o2 * inner[11] + o3,
    )
  }
  return r
}

/**
 * 平移矩阵。
 * @param offset - the translation vector (mm).
 * @returns the affine matrix.
 */
export function translationAffine(offset: V3): PmiAffine {
  return [1, 0, 0, offset[0], 0, 1, 0, offset[1], 0, 0, 1, offset[2]]
}

/**
 * 欧拉旋转矩阵（XYZ 序，度，可选 pivot）。
 *
 * 直接复用 `math3d` 的 `Euler` / `Mat4`：`api/transform.ts` 的 mesh 路径
 * （`mesh/transform.ts#rotate_euler`）与 brep 路径（`brep/brep-ops.ts#rotateBrep`）
 * 用的就是这两个类，转序/符号必然一致。
 *
 * @param anglesDeg - euler angles in degrees (X, Y, Z).
 * @param pivot - optional rotation pivot (mm).
 * @returns the affine matrix.
 */
export function rotationAffine(anglesDeg: V3, pivot?: V3): PmiAffine {
  const rad = Math.PI / 180
  const euler = new Euler(anglesDeg[0] * rad, anglesDeg[1] * rad, anglesDeg[2] * rad)
  const m = new Mat4().makeRotationFromEuler(euler)
  if (pivot !== undefined) {
    m.premultiply(new Mat4().makeTranslation(pivot[0], pivot[1], pivot[2]))
    m.multiply(new Mat4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
  }
  const e = m.elements
  // Mat4 是列主序，PMI 仿射是行主序（同 brep-ops#matrixToArray）
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]
}

/**
 * 缩放矩阵（三轴系数 + 不动点）：`p' = center + f · (p − center)`。
 * @param factor - per-axis scale factors.
 * @param center - fixed point of the scaling (default origin).
 * @returns the affine matrix.
 */
export function scalingAffine(factor: V3, center?: V3): PmiAffine {
  const c = center ?? [0, 0, 0]
  return [
    factor[0], 0, 0, c[0] - factor[0] * c[0],
    0, factor[1], 0, c[1] - factor[1] * c[1],
    0, 0, factor[2], c[2] - factor[2] * c[2],
  ]
}

/**
 * 镜像矩阵（det=−1）：跨过点 `at`、法向 `normal` 的平面反射。
 *
 * `R = I − 2·n·nᵀ`（`n` 单位化），`t = at − R·at`，即 `p' = at + R·(p − at)`。
 * 反射翻转手性（det=−1），但本模块只搬点/方向——`affineApplyDirection` 变换后
 * 归一化，反射后的孔轴方向天然正确；`remapPmiItem` 不区分手性。
 *
 * 与几何路径同一缺省：`mirrorBrep` / mesh 路径的 mirror 默认 normal [1,0,0]、
 * at 原点。零法向 → 抛错（`finalizePmi` 捕获后静默不登记——纯显示问题不中断建模）。
 *
 * @param normal - mirror plane normal (normalized internally; zero → throws).
 * @param at - a point on the mirror plane (default origin).
 * @returns the affine matrix (det(R) = −1).
 */
export function mirrorAffine(normal: V3, at: V3 = [0, 0, 0]): PmiAffine {
  const len = Math.hypot(normal[0], normal[1], normal[2])
  if (len < 1e-9) throw new Error('[mirrorAffine] mirror plane normal must be non-zero')
  const nx = normal[0] / len
  const ny = normal[1] / len
  const nz = normal[2] / len
  // R = I − 2nnᵀ
  const r00 = 1 - 2 * nx * nx
  const r01 = -2 * nx * ny
  const r02 = -2 * nx * nz
  const r10 = -2 * ny * nx
  const r11 = 1 - 2 * ny * ny
  const r12 = -2 * ny * nz
  const r20 = -2 * nz * nx
  const r21 = -2 * nz * ny
  const r22 = 1 - 2 * nz * nz
  // t = at − R·at（把平面上的不动点折进平移）
  const tx = at[0] - (r00 * at[0] + r01 * at[1] + r02 * at[2])
  const ty = at[1] - (r10 * at[0] + r11 * at[1] + r12 * at[2])
  const tz = at[2] - (r20 * at[0] + r21 * at[1] + r22 * at[2])
  return [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz]
}

/**
 * 把一条标注里的**裸世界坐标**按 `a` 重映射（其余种类原样返回）。
 *
 * 只碰两类字段：`localNote.anchor` / `localNote.leaderDirection`（点 + 方向）与
 * `threadHole.axis`（点 + 方向）。`TopoRef` 一律不动——它有自己的坐标系，由
 * `resolveTopoRef` 沿血缘解析，施加外部矩阵会把它算错。
 *
 * @param item - the annotation to remap.
 * @param a - the cumulative affine matrix.
 * @returns a remapped copy (or the same object when nothing to remap).
 */
export function remapPmiItem(item: PmiItem, a: PmiAffine): PmiItem {
  switch (item.kind) {
    case 'localNote': {
      if (item.anchor === undefined && item.leaderDirection === undefined) return item
      return {
        ...item,
        ...(item.anchor === undefined ? {} : { anchor: affineApplyPoint(a, item.anchor) }),
        ...(item.leaderDirection === undefined
          ? {}
          : { leaderDirection: affineApplyDirection(a, item.leaderDirection) }),
      }
    }
    case 'threadHole': {
      return {
        ...item,
        axis: {
          origin: affineApplyPoint(a, item.axis.origin),
          direction: affineApplyDirection(a, item.axis.direction),
        },
      }
    }
    default:
      return item
  }
}
