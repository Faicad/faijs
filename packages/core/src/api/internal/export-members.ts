/**
 * export-members — 导出命令的「入参 Shape → 成员表」（方案 §2.6 定式 3 的共用件）
 *
 * `cad.exportStep`（`api/export-step.ts`）与 `cad.export3mf`（`api/export-3mf.ts`）
 * 是同一个库面序列化器（`brep/export/export-model.ts#exportModelSync`）的两个脚本面
 * 薄壳。两者的差别只有「一个成员交给写出器的载荷是 `solid` 还是 `mesh`」；把入参拆
 * 成成员表这一步完全一致，故收在本文件——两份拷贝各自漂移会让脚本面与库面同源
 * （矩阵 B12 / B14）失去保障。
 *
 * 拆解口径对齐现成先例 `node-host/cli.ts#writeAssemblyStep`：
 * - 成员 = `CompoundShape.children`（同序；嵌套 compound 不递归展开，与先例一致）；
 * - 成员名 = `behavior.memberNames[i]`（装配 op 写入的短名，`memberColors` 亦以它为
 *   键），无装配 behavior 时回落 `nameOf(child)`；
 * - 成员色 = `behavior.memberColors[成员名]`（sRGB 0–1，STEP 写 XCAF COLOUR_RGB、
 *   3MF 写 basematerials）；
 * - 非 compound 入参 = 单成员、不带名与色，与 `cli.ts#writeOutput`（`:744-758`）同
 *   口径——单件导出不写名。
 *
 * 判定用**结构**判定 `isCompoundLike` 而非 SDK 的 `isShape`/`isCompound`：本 op 吃
 * 的是脚本文本传进来的值，可能是跨库产物，不能对它提「必须由本库构造器创建」的要求
 * （同 `keep-syntax §5.3 D5` 的既有取舍）。
 *
 * 成员几何一律由调用方**现场**读（`brepOf(child)`），不取创建期快照：装配变换在语句
 * 之后才烘进 `slot.solid`，快照对已变换成员是陈旧的（`cli.ts#writeAssemblyStep` 的
 * 同款注释）。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import type { CompoundShape } from '../../shape'
import { getSlot, isCompoundLike } from '../../shape'
import { nameOf } from '../../runtime-state'

/** 导出成员：一个待导出的几何 + 其身份（名 / 色）。 */
export interface ExportMember {
  /** 成员几何：compound 的成员，或单件入参本身。 */
  shape: Shape
  /** 成员名（写 STEP PRODUCT 名 / 3MF `<object name>`）；无名时缺省。 */
  name?: string
  /** sRGB 0–1 成员色（来自装配 behavior 的 `memberColors`）。 */
  color?: readonly [number, number, number]
}

/**
 * 装配 behavior 里与导出相关的两个字段（`@faicad/faijs-extra` 的 `assembly` op 写入；
 * 本文件只读不写，也不 import 扩展库——core 不得依赖 extra）。
 */
interface ExportBehavior {
  memberNames?: string[]
  memberColors?: Record<string, [number, number, number]>
}

/**
 * 把导出命令的入参拆成成员表。
 *
 * @param input - 单件 Shape 或装配 compound（结构判定）。
 * @returns 成员表；空 compound 返回空数组——调用方必须显式报错，不得落空文件。
 */
export function exportMembersOf(input: Shape | CompoundShape): ExportMember[] {
  if (!isCompoundLike(input)) return [{ shape: input }]
  const behavior = getSlot(input)?.behavior as ExportBehavior | undefined
  const names = behavior?.memberNames
  const members: ExportMember[] = []
  for (let i = 0; i < input.children.length; i++) {
    const child = input.children[i]!
    const raw = names?.[i] ?? nameOf(child)
    const name = raw === undefined || raw === '' ? undefined : String(raw)
    const color = name === undefined ? undefined : behavior?.memberColors?.[name]
    members.push({
      shape: child,
      ...(name === undefined ? {} : { name }),
      ...(color === undefined ? {} : { color }),
    })
  }
  return members
}

/** 装配节点位姿（与 `Shape.transform` 同形态，见 mesh/types.ts）。 */
export interface ExportTransform {
  translate?: Vec3
  rotate?: { angle: number; axis?: Vec3 }
  matrix?: number[]
}

/** 导出成员树节点：结构（名 / 色 / 位姿 / 子节点）与几何（shape）分离。 */
export interface ExportMemberNode {
  /** 成员几何：compound 的成员，或单件入参本身。 */
  shape: Shape
  /** 成员名（写 3MF `<object name>` / STEP PRODUCT 名）；无名时缺省。 */
  name?: string
  /** sRGB 0–1 成员色（来自装配 behavior 的 `memberColors`）。 */
  color?: readonly [number, number, number]
  /** 本节点相对父的位姿（来自 `shape.transform`）。 */
  transform?: ExportTransform
  /** 子节点（嵌套装配）；非 compound 叶节点缺省。 */
  children?: ExportMemberNode[]
}

/**
 * 导出命令入参 → 成员树（方案 §2.1「装配模型 = 节点属性，单一真源」的脚本面投影）。
 * 与 `exportMembersOf`（平铺）不同，本函数**保留嵌套**：compound 的成员若自身是
 * compound 则递归展开为子树（同序），叶节点携带其 `shape.transform` 作为相对父位姿。
 *
 * 名称 / 颜色取自各层 compound 的 behavior（`memberNames` / `memberColors`，装配 op
 * 写入；core 只读不写，不 import extra）。本层只管结构，几何载荷由调用方（各 op）
 * 现场读取——避免创建期快照陈旧（同 `exportMembersOf` 注释）。
 *
 * @param input - 脚本面导出命令的入参形状（叶或 compound 装配）。
 * @returns 保留嵌套结构的成员树；叶节点携带 `shape.transform` 作为相对父位姿。
 */
export function exportTreeOf(input: Shape | CompoundShape): ExportMemberNode[] {
  const leaf = (s: Shape, name?: string, color?: readonly [number, number, number]): ExportMemberNode => {
    const node: ExportMemberNode = { shape: s }
    const t = s.transform as ExportTransform | undefined
    if (t) node.transform = t
    if (name !== undefined) node.name = name
    if (color !== undefined) node.color = color
    return node
  }
  const build = (s: Shape | CompoundShape): ExportMemberNode => {
    if (!isCompoundLike(s)) return leaf(s as Shape)
    const behavior = getSlot(s)?.behavior as ExportBehavior | undefined
    const names = behavior?.memberNames
    const children: ExportMemberNode[] = []
    for (let i = 0; i < s.children.length; i++) {
      const child = s.children[i]!
      if (isCompoundLike(child)) {
        children.push(build(child))
      } else {
        const raw = names?.[i] ?? nameOf(child)
        const name = raw === undefined || raw === '' ? undefined : String(raw)
        const color = name === undefined ? undefined : behavior?.memberColors?.[name]
        children.push(leaf(child, name, color))
      }
    }
    const node = leaf(s as Shape)
    node.children = children
    return node
  }
  return isCompoundLike(input) ? [build(input)] : [leaf(input as Shape)]
}
