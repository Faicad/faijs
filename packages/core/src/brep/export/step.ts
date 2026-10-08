/**
 * exportStepFromSolids — L1 STEP 导出（从 OCCT solid 句柄，多实体、零 fuse）
 *
 * @platform occt — 本文件 import occt-kernel（createXCAFDocument/XCAF label 写入是
 * occt-only 平台面，D3）。文件级标注满足守卫①（平台 import 自证身份）。
 *
 * 每个 entry 作为 STEP 中一个独立实体（独立 XCAF label / PRODUCT）导出，
 * 保留名称与颜色。多实体之间绝不 fuse —— 这是硬性约定：
 * fuse 只允许作为用户脚本里的几何布尔运算，禁止作为导出时的实体合并手段。
 *
 * 导出 → 再导入身份闭环：导入侧 importAssemblyFromStep（XCAF）会把
 * 多实体 STEP 还原为多个 part；多 solid compound 拆分出的子节点命名为
 * `name [n]`，与本节点的展平命名规则一致。
 */

import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import type { XCAFDocument } from 'occt-wasm'
import { reconstructSolidFromMesh } from '../../occt-kernel/meshReconstruct'
import { getOcctKernel, type ShapeHandle } from '../../occt-kernel/occtKernel'
import type { FileMeta } from '../../api/meta'
import { rewriteStepHeader, fileMetaHasHeaderFields } from './step-meta-header'
import { transformToMatrix12, type NodeTransform } from './transform12'
import { composeMatrix12 } from './stl'

/** STEP 导出条目：一个 part（精确 BREP 形状或三角网格，二选一）或一个装配容器。 */
export interface StepExportEntry {
  /** 精确 BREP 形状（solid/shell/face/compound，来自宿主导出缓存）。与 mesh 二选一，solid 优先。 */
  solid?: BrepHandle
  /** 三角网格（世界坐标、已按单位缩放），经 reconstructSolidFromMesh 重建为实体。 */
  mesh?: { positions: Float32Array; indices: Uint32Array }
  /** 实体名称（写入 label name，导出为 PRODUCT 名称）。 */
  name?: string
  /** RGB 0..1 颜色（sRGB 编码，如宿主材质 base color）。写入前转 linear。 */
  color?: [number, number, number]
  /**
   * 装配子节点（方案 2026-10-08 步骤 7 / P3）：非空时本条目按**真装配容器**写出
   * （XCAF assembly + component），不再展平为平级 PRODUCT。容器自身不贡献几何
   * （compound 几何 == 成员并集，写出会重复）。
   *
   * wasm 限制（step-export.test.ts 双值钉住）：① 组件位姿的**旋转**烘进原型几何、
   * 只有平移走 location（wasm location 旋转当前不生效）；② 容器有名时首叶自己的
   * 名字让位（组件 setName 不过 STEP）；③ 嵌套容器的叶递归收集后作为顶层容器的
   * 直接组件（子装配分组待 wasm 提供空装配 label 原语后升级）。
   */
  children?: StepExportEntry[]
  /**
   * 本节点相对父的位姿（与 `Shape.transform` 同形态，坐标已按单位刻度换算）。
   * 直接子节点写 XCAF component location；更深层的叶子烘进几何。
   */
  transform?: NodeTransform
}

/**
 * sRGB → linear 转换。
 *
 * OCCT XCAF 内部按 linear RGB 存储颜色，STEP writer（xcafExportSTEP）
 * 导出时做 linear→sRGB 编码写 COLOUR_RGB。为了让"宿主传入的 sRGB 颜色 ==
 * STEP 文件中的 COLOUR_RGB == 回读颜色"，写入前必须先转 linear。
 *
 * @param c sRGB 编码值（0..1）
 * @returns linear 值（0..1）
 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * 3×3 行主序旋转矩阵 → 是否单位旋转。
 */
function isIdentityRotation(m: number[]): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0
    && m[4] === 0 && m[5] === 1 && m[6] === 0
    && m[8] === 0 && m[9] === 0 && m[10] === 1
}

/**
 * 节点位姿拆分 → { 烘焙矩阵（仅旋转），location 平移 }。
 *
 * **为什么旋转烘进几何而不是走 location**（P7 当前限制，测试钉住）：wasm
 * `addChild({location:{rx,ry,rz}})` 的旋转分量当前不生效——写出→回读 location
 * 恒为单位旋转（平移正常）。把旋转烘进原型几何、平移留在 location，世界几何
 * 保真；occt-wasm 修复 location 旋转后改为完整位姿走 location 并翻转测试。
 * 坐标刻度由调用方保证（export-model 映射时已按单位换算平移分量）。
 */
function splitTransform(t: NodeTransform | undefined): { bakeM: number[] | null; location: { tx: number; ty: number; tz: number } | undefined } {
  if (!t) return { bakeM: null, location: undefined }
  const m = transformToMatrix12(t)
  const location = { tx: m[3]!, ty: m[7]!, tz: m[11]! }
  if (isIdentityRotation(m)) return { bakeM: null, location }
  const R = [m[0]!, m[1]!, m[2]!, 0, m[4]!, m[5]!, m[6]!, 0, m[8]!, m[9]!, m[10]!, 0]
  return { bakeM: R, location }
}

/**
 * 装配容器的叶子收集：嵌套容器递归展开，位姿沿树复合（行主序 3×4）。
 * `nested` = 该叶经过了嵌套容器（非顶层容器的直接子节点）。
 */
function collectAssemblyLeaves(
  list: StepExportEntry[],
  parentM: number[] | null,
  out: Array<{ entry: StepExportEntry; world: number[] | null; nested: boolean }>,
): void {
  for (const c of list) {
    const m = c.transform ? transformToMatrix12(c.transform) : null
    const world = m && parentM ? composeMatrix12(parentM, m) : m ?? parentM
    if (c.children && c.children.length > 0) {
      collectAssemblyLeaves(c.children, world, out)
    } else {
      out.push({ entry: c, world, nested: parentM !== null })
    }
  }
}

function isIdentity12(m: number[]): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0
    && m[4] === 0 && m[5] === 1 && m[6] === 0 && m[7] === 0
    && m[8] === 0 && m[9] === 0 && m[10] === 1 && m[11] === 0
}

/**
 * 写一个装配容器为真装配（XCAF assembly + component，方案步骤 7 / P3）。
 *
 * XCAF 原语约束：`addChild` 只收 shape 句柄、且「part 在首个 child 加入时转为
 * assembly，原几何移入 identity 首组件」。因此：
 * - 首叶几何升起为容器 label 的初始 part（容器名 / 色优先），其位姿烘进几何；
 * - 其余**直接**子叶经 `addChild({location})` 写真组件位姿；
 * - 嵌套容器的叶（`nested`）位姿复合后烘进几何、以 identity 位置加入——几何与
 *   名色保真，子装配分组待 wasm 提供空装配 label 原语后升级。
 */
function writeAssemblyContainer(
  kernel: BrepEngineApi,
  doc: XCAFDocument,
  entry: StepExportEntry,
  ownedHandles: BrepHandle[],
): void {
  const resolveSolid = (e: StepExportEntry): BrepHandle => {
    if (e.solid) return e.solid
    if (!e.mesh) throw new Error('StepExportEntry must provide either solid or mesh')
    const s = reconstructSolidFromMesh(kernel, e.mesh.positions, e.mesh.indices)
    ownedHandles.push(s)
    return s
  }
  const bake = (e: StepExportEntry, m: number[] | null): BrepHandle => {
    const base = resolveSolid(e)
    if (!m || isIdentity12(m)) return base
    const placed = kernel.transform(base, m)
    ownedHandles.push(placed)
    return placed
  }
  const linear = (c: [number, number, number] | undefined): [number, number, number] | undefined =>
    c ? [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])] : undefined

  const leaves: Array<{ entry: StepExportEntry; world: number[] | null; nested: boolean }> = []
  collectAssemblyLeaves(entry.children ?? [], null, leaves)
  if (leaves.length === 0) throw new Error('Assembly container has no leaf geometry')

  const [first, ...rest] = leaves
  const label = doc.addShape(bake(first!.entry, first!.world) as unknown as ShapeHandle, {
    name: entry.name ?? first!.entry.name,
    color: linear(entry.color ?? first!.entry.color),
  })
  // 名字取舍（wasm 限制，测试钉住）：几何升起后首组件沿用容器 label 的名/色；
  // 组件 label 的 setName 不过 STEP 导出（回读仍为容器名），故容器有名时首叶
  // 自己的名字让位——容器无名则首叶名升起为容器名。
  for (const leaf of rest) {
    let solid: BrepHandle
    let location: { tx: number; ty: number; tz: number } | undefined
    if (leaf.nested) {
      // 嵌套容器的叶：位姿全量复合后烘进几何，identity 位置加入。
      solid = bake(leaf.entry, leaf.world)
    } else {
      // 直接子叶：旋转烘进几何（P7 当前限制），平移留在 location。
      const split = splitTransform(leaf.entry.transform)
      solid = bake(leaf.entry, split.bakeM)
      location = split.location
    }
    doc.addChild(label, solid as unknown as ShapeHandle, {
      ...(leaf.entry.name === undefined ? {} : { name: leaf.entry.name }),
      ...(leaf.entry.color === undefined ? {} : { color: linear(leaf.entry.color) }),
      ...(location === undefined ? {} : { location }),
    })
  }
}

/**
 * Export multiple BREP solids (and/or triangle meshes) to STEP, one
 * independent entity per entry — no fuse, no string splicing.
 *
 * @param kernel  OCCT kernel (must match the one that created the solids)
 * @param entries parts to export; each becomes its own XCAF label
 * @param fileMeta optional file-level metadata; mapped to the P21 header
 *                 (`FILE_NAME`/`FILE_DESCRIPTION`) via text rewrite
 *                 (`rewriteStepHeader`). No effect on geometry/DATA entities.
 * @returns STEP file content as ArrayBuffer
 * @throws if entries is empty, or a mesh entry fails to reconstruct
 */
export function exportStepFromSolids(
  kernel: BrepEngineApi,
  entries: StepExportEntry[],
  fileMeta?: FileMeta,
): ArrayBuffer {
  if (entries.length === 0) {
    throw new Error('No exportable geometry')
  }

  const doc = getOcctKernel().createXCAFDocument()
  // 本函数创建的句柄（展平出的子 solid + mesh 重建的 solid），导出后释放。
  // 缓存里的原 solid（entry.solid）绝不释放，归调用方/缓存所有。
  const ownedHandles: BrepHandle[] = []

  try {
    for (const entry of entries) {
      // 0. 装配容器 → 真装配写入（XCAF assembly + component，步骤 7 / P3）。
      if (entry.children && entry.children.length > 0) {
        writeAssemblyContainer(kernel, doc, entry, ownedHandles)
        continue
      }
      // 1. 解析 solid：优先用精确 solid；无则从三角网格重建
      let solid = entry.solid
      if (!solid) {
        if (!entry.mesh) {
          throw new Error('StepExportEntry must provide either solid or mesh')
        }
        solid = reconstructSolidFromMesh(kernel, entry.mesh.positions, entry.mesh.indices)
        ownedHandles.push(solid)
      }

      // 2. 展平 Compound（多 solid 导入的 part 其 solid 是 Compound）；
      //    纯 solid 时 getSubShapes('solid') 返回 [自身]。
      //    形状类型分派：solid → shell → face → edge。ref 侧（cadquery
      //    Shape.exportStep）可导出任意类型的形状，面/壳/边 compound（如
      //    Shape.faces('>Z') / shape.edges('>Z') 的结果）同样要能写进
      //    STEP（U22，2026-09-09）。
      let subs = kernel.getSubShapes(solid, 'solid')
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'shell')
      }
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'face')
      }
      if (subs.length === 0) {
        subs = kernel.getSubShapes(solid, 'edge')
      }
      if (subs.length === 0) {
        // wasm getSubShapes 不展开 compound 层（TopExp_Explorer 默认跳过），
        // 纯面/壳/边 compound（如 Shape.siblings / faces('>Z') 结果）在这里
        // 拿不到子形状。把 compound 整体作为单个 XCAF label 写入（STEP
        // writer 支持 compound 形状，与 ref 侧 cadquery Shape.exportStep
        // 对 faces/edges compound 的行为一致）。
        subs = [solid]
      }
      for (let si = 0; si < subs.length; si++) {
        const sub = subs[si]
        // 展平出的子句柄若不属于调用方缓存，记入 ownedHandles
        if (solid !== sub) ownedHandles.push(sub)
        const name = subs.length > 1
          ? `${entry.name ?? 'part'} [${si + 1}]`
          : entry.name
        // sRGB → linear：XCAF 按 linear 存储，STEP writer 输出时线性→sRGB，
        // 转换后 STEP 文件里的 COLOUR_RGB 才是宿主传入的原始 sRGB 值。
        const color: [number, number, number] | undefined = entry.color
          ? [srgbToLinear(entry.color[0]), srgbToLinear(entry.color[1]), srgbToLinear(entry.color[2])]
          : undefined
        // 平台面（D3）：XCAF label 写入是 occt-only。BrepHandle ↔ ShapeHandle
        // 运行时同构，品牌转换只发生在平台边界。
        doc.addShape(sub as unknown as ShapeHandle, { name, color })
      }
    }

    // 3. 导出（每个 label 一个独立 PRODUCT，保留名称/颜色）
    const stepText = doc.exportSTEP()
    // 文件级 meta → P21 header 重写（title/creationDate/createor/author/org/
    // application/description）。无 header 字段时不重写。文本层只改声明不碰几何。
    const out = fileMeta && fileMetaHasHeaderFields(fileMeta)
      ? rewriteStepHeader(stepText, fileMeta)
      : stepText
    return new TextEncoder().encode(out).buffer
  } finally {
    // 4. 释放顺序：先关文档，再释放本函数创建的句柄
    doc.close()
    for (const h of ownedHandles) {
      try {
        kernel.release(h)
      } catch {
        // already released
      }
    }
  }
}

/**
 * Export a BREP solid (OCCT native) to STEP format.
 *
 * 单实体导出 = exportStepFromSolids 的单条目特例（同一实现，无第二真源）。
 *
 * @param solid   OCCT solid handle
 * @param kernel  OCCT kernel (must match the one that created the solid)
 * @returns STEP file content as ArrayBuffer
 */
export function exportStepFromSolid(
  solid: BrepHandle,
  kernel: BrepEngineApi,
): ArrayBuffer {
  return exportStepFromSolids(kernel, [{ solid }])
}