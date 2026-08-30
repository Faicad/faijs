/**
 * occt-wasm 封装层 — 替代 occt-import-js
 *
 * 提供 STEP/BREP → Mesh 转换和 Mesh → STEP 导出能力。
 * 利用 occt-wasm 的 meshShape() 获取 faceGroups（面→三角形映射），
 * 利用 wireframe() 获取边折线数据，利用 edgeToFaceMap() 获取边→面关联。
 */
import type { OcctKernel, ShapeHandle, Mesh, EdgeData, SurfaceKind, CurveKind, BoundingBox, Vec3, XCAFDocument, LabelInfo, LabelTag } from 'occt-wasm'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getSolidColorsOrdered } from './stepColorParser'

export interface WasmTessellatedMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

export interface WasmImportResult {
  shapeHandle: ShapeHandle
  meshes: WasmTessellatedMesh[]
  meshWithGroups: Mesh
}

let kernelInstance: OcctKernel | null = null
let initPromise: Promise<BrepEngineApi> | null = null

// F5 设计意图说明：
// kernelInstance / initPromise 是环境级单例，不是实例级。
// 在整个浏览器页面/Node 进程中，OCCT WASM 只应初始化一次。
// 多个 CadRuntime 实例共享同一个 kernel 是正确的行为。

/** 浏览器 host 注入的 OCCT 初始化函数 */
let customInitFn: (() => Promise<OcctKernel>) | null = null

/**
 * 浏览器 host 注入 OCCT 初始化函数。
 *
 * 浏览器 host 调用此函数注册自己的初始化逻辑（dev/prod/CDN/e2e 分支），
 * faijs 的 initOcctWasm() 会优先使用注入的函数。
 *
 * 如果未注入，initOcctWasm() 在 Node 环境下从 node_modules 读取 WASM。
 */
export function setOcctWasmInitFn(fn: (() => Promise<OcctKernel>) | null): void {
  customInitFn = fn
}

/**
 * 解析 occt-wasm 的 WASM 文件路径（linker-agnostic）。
 *
 * 走 package exports（occt-wasm@3.8.4 导出了 `"./dist/occt-wasm.wasm"`），
 * 与 cwd / hoisting / pnpm|npm linker 全部无关（实测 pattern C）。
 * 替代旧的 4 层 `..` 路径猜测 + process.cwd() 兜底（monorepo-plan P-0）。
 *
 * ⚠️ 惰性获取 node:module（Node ≥ 20.16 的 process.getBuiltinModule）：不能用
 * 静态 `import { createRequire } from 'node:module'`——occtKernel 在浏览器构建
 * （demo vite build）的 import 链上，静态 node:* import 会被外部化后报错。
 * 本函数只在 Node 分支（initOcctWasm）被调用，浏览器环境永不执行。
 */
export function resolveOcctWasmPath(): string {
  const builtin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('node:module') as
    | { createRequire: (filename: string) => { resolve: (id: string) => string } }
    | undefined
  if (!builtin) {
    throw new Error('[faijs] resolveOcctWasmPath requires Node.js (process.getBuiltinModule)')
  }
  return builtin.createRequire(import.meta.url).resolve('occt-wasm/dist/occt-wasm.wasm')
}

/**
 * 初始化 occt-wasm 内核（单例）。
 *
 * - Node.js 测试环境：从 node_modules 读取 WASM 文件，传入 ArrayBuffer。
 * - 开发环境：直接 ESM import，Vite 解析 node_modules。
 *   WASM 文件从 public/wasm/occt-wasm.wasm 加载。
 * - 生产环境：从 CDN 动态 import 整个模块 + WASM。
 */
export async function initOcctWasm(): Promise<BrepEngineApi> {
  if (kernelInstance) return kernelInstance as unknown as BrepEngineApi
  if (initPromise) return initPromise as unknown as Promise<BrepEngineApi>

  initPromise = (async () => {
    // 优先使用浏览器 host 注入的初始化函数
    if (customInitFn) {
      kernelInstance = await customInitFn()
      return kernelInstance as unknown as BrepEngineApi
    }

    // Node.js 环境：从 node_modules 读取 WASM 文件
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { OcctKernel: Ctor } = await import('occt-wasm')
      const { readFileSync } = await import('node:fs')
      const wasmPath = resolveOcctWasmPath()
      const buf = readFileSync(wasmPath)
      const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      kernelInstance = await Ctor.init({ wasm: wasmBinary })
      return kernelInstance as unknown as BrepEngineApi
    }

    throw new Error('initOcctWasm: no init function set and not in Node environment. Call setOcctWasmInitFn() first.')
  })()

  return initPromise as unknown as Promise<BrepEngineApi>
}

/** 获取已初始化的 kernel 实例（必须先调用 initOcctWasm）。 */
export function getKernel(): OcctKernel {
  if (!kernelInstance) throw new Error('occt-wasm kernel not initialized — call initOcctWasm() first')
  return kernelInstance
}

/** 释放 kernel 实例（应用卸载时调用）。 */
export function disposeOcctWasm(): void {
  if (kernelInstance) {
    kernelInstance[Symbol.dispose]()
    kernelInstance = null
    initPromise = null
  }
}

export interface MeshDeflectionOptions {
  linearDeflection?: number
  angularDeflection?: number
  /** If true, linearDeflection is multiplied by the bounding-box diagonal
   *  (matches OCCT's BRepMesh_IncrementalMesh relative=true behaviour). */
  relative?: boolean
}

/** Compute the effective linear deflection, applying relative scaling
 *  exactly as OCCT does internally: `linDefl * bboxDiagonal` when relative=true. */
export function computeEffectiveDeflection(
  kernel: BrepEngineApi,
  shape: BrepHandle,
  options: MeshDeflectionOptions = {},
): { linearDeflection: number; angularDeflection: number } {
  const ld = options.linearDeflection ?? 0.1
  const ad = options.angularDeflection ?? 0.5
  const relative = options.relative ?? false
  if (!relative) return { linearDeflection: ld, angularDeflection: ad }

  // OCCT: BRepBndLib::AddOptimal → bbox diagonal → deflection *= diagonal
  // 浏览器 WASM 中 compound shape 可能使 getBoundingBox 抛异常，需要容错
  let bb: BoundingBox
  try {
    bb = kernel.getBoundingBox(shape, false)
  } catch {
    try {
      bb = kernel.getBoundingBox(shape, true)
    } catch {
      // 无法获取 bbox → 返回非相对模式的默认值
      return { linearDeflection: ld, angularDeflection: ad }
    }
  }
  const dx = bb.xmax - bb.xmin
  const dy = bb.ymax - bb.ymin
  const dz = bb.zmax - bb.zmin
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return { linearDeflection: ld * diag, angularDeflection: ad }
}

/**
 * 导入 STEP → ShapeHandle + Mesh（含 faceGroups）。
 *
 * 使用 meshShape() 而非 tessellate()，以获取 faceGroups 数据
 * （每个面的三角形范围 [triStart, triCount, faceHash]）。
 */
export async function importStepToMesh(
  stepData: ArrayBuffer | Uint8Array,
  deflection?: MeshDeflectionOptions,
): Promise<WasmImportResult> {
  const kernel = (await initOcctWasm()) as unknown as OcctKernel
  const ab = stepData instanceof Uint8Array ? stepData.buffer.slice(stepData.byteOffset, stepData.byteOffset + stepData.byteLength) as ArrayBuffer : stepData
  const shape = kernel.importStep(ab)

  const eff = computeEffectiveDeflection(kernel as unknown as BrepEngineApi, shape as unknown as BrepHandle, deflection)
  const mesh = kernel.meshShape(shape, { linearDeflection: eff.linearDeflection, angularDeflection: eff.angularDeflection })

  return {
    shapeHandle: shape,
    meshes: [{
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
    }],
    meshWithGroups: mesh,
  }
}

// ── Assembly (XCAF) support ──

/** A node in the XCAF assembly tree (mirrors the STEP_T occurrence concept). */
export interface AssemblyPartNode {
  /** Dotted path: 'o0', 'o0.o1', 'o0.o1.o2' — matches STEP_T occurrence path. */
  labelPath: string
  /** XCAF label name (falls back to labelPath if empty). */
  name: string
  /** True if this node is an assembly (has child components). */
  isAssembly: boolean
  /** True if this node is a component reference (leaf part with location). */
  isComponent: boolean
  /** Shape handle with location baked in (for components) or raw shape (for roots).
   *  Caller must release this handle. Null for empty assembly labels. */
  shapeHandle: ShapeHandle | null
  /** Deduplication key for prototype shapes (same geometry = same key).
   *  Only set for leaf (non-assembly) nodes. */
  prototypeKey: string | null
  /** RGB color [r,g,b] in 0..1 range, or null if no color. */
  color: [number, number, number] | null
  /** Child nodes (recursive). Empty for leaf parts. */
  children: AssemblyPartNode[]
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/**
 * Import a STEP file via XCAF (STEPCAFControl_Reader), preserving the assembly
 * tree, names, colors, and per-component locations.
 *
 * Unlike `importStepToMesh` (which flattens via STEPControl_Reader.OneShape()),
 * this function returns the full assembly tree structure.
 *
 * The caller is responsible for releasing all shapeHandle values in the tree
 * (use `releaseAssemblyTree`).
 */
export async function importAssemblyFromStep(
  stepData: ArrayBuffer | Uint8Array,
): Promise<AssemblyPartNode[]> {
  const kernel = (await initOcctWasm()) as unknown as OcctKernel
  const stepText = stepData instanceof Uint8Array
    ? new TextDecoder().decode(stepData)
    : new TextDecoder().decode(new Uint8Array(stepData))

  // Parse sub-shape colors from STEP text (fallback for when XCAF label has no color).
  // STEP files from NX/SolidWorks often store colors as STYLED_ITEM on individual
  // solids rather than on XCAF labels, so getLabelInfo returns hasColor=false.
  const solidColors = getSolidColorsOrdered(stepText)

  // XCAFDocument.fromSTEP uses STEPCAFControl_Reader with color/name/layer modes
  const doc = kernel.importXCAFFromSTEP(stepText)
  try {
    const rootTags = doc.getRoots()
    const nodes: AssemblyPartNode[] = []
    const cursor = { idx: 0 }
    for (let i = 0; i < rootTags.length; i++) {
      nodes.push(walkLabel(kernel, doc, rootTags[i], `o${i}`, solidColors, cursor))
    }
    return nodes
  } finally {
    doc.close()
  }
}

/** Walk-context: tracks the current position in the solidColors array across
 *  recursive walkLabel calls so that multi-solid compounds consume colors in order. */
interface WalkCtx {
  idx: number
}

function walkLabel(
  kernel: OcctKernel,
  doc: XCAFDocument,
  tag: LabelTag,
  path: string,
  solidColors: ([number, number, number] | null)[],
  ctx: WalkCtx,
): AssemblyPartNode {
  const info: LabelInfo = doc.getLabelInfo(tag)
  const name = info.name || path
  const color = info.hasColor ? [info.color[0], info.color[1], info.color[2]] as [number, number, number] : null

  if (info.isAssembly) {
    const childTags = doc.getChildren(tag)
    const children: AssemblyPartNode[] = []
    for (let i = 0; i < childTags.length; i++) {
      children.push(walkLabel(kernel, doc, childTags[i], `${path}.o${i}`, solidColors, ctx))
    }
    // Assembly nodes have no shape of their own; release if one was returned
    if (info.shapeHandle) kernel.release(info.shapeHandle)
    return {
      labelPath: path,
      name,
      isAssembly: true,
      isComponent: false,
      shapeHandle: null,
      prototypeKey: null,
      color,
      children,
    }
  }

  // Leaf component — shapeHandle has location baked in (OCCT GetShape semantics)
  // Check if this is a compound with multiple solids — if so, split into
  // separate child nodes so each solid becomes its own mesh/scene-tree node.
  // This handles STEP files that have a single PRODUCT containing a compound
  // of multiple MANIFOLD_SOLID_BREP entities (common in NX/SolidWorks exports).
  if (info.shapeHandle) {
    const solids = kernel.getSubShapes(info.shapeHandle, 'solid')
    if (solids.length > 1) {
      // Multi-solid compound → split into virtual assembly children
      // Each child gets its own solid shapeHandle (already at correct location
      // because getSubShapes extracts from the located compound).
      const children: AssemblyPartNode[] = []
      for (let si = 0; si < solids.length; si++) {
        const childPath = `${path}.s${si}`
        const childName = `${name} [${si + 1}]`
        let childProtoKey: string | null
        try {
          childProtoKey = String(kernel.hashCode(solids[si], 2147483647))
        } catch {
          childProtoKey = null
        }
        // Use STEP-parsed color if label has no color (sub-shape level color)
        const childColor = color ?? (solidColors[ctx.idx] ?? null)
        ctx.idx++
        children.push({
          labelPath: childPath,
          name: childName,
          isAssembly: false,
          isComponent: true,
          shapeHandle: solids[si],
          prototypeKey: childProtoKey,
          color: childColor,
          children: [],
        })
      }
      // Release the compound shape itself — children hold individual solids
      kernel.release(info.shapeHandle)
      return {
        labelPath: path,
        name,
        isAssembly: true, // mark as assembly so it becomes a group node
        isComponent: false,
        shapeHandle: null,
        prototypeKey: null,
        color,
        children,
      }
    }
    // Single solid (or non-solid) — release the extra sub-shape handles
    for (const s of solids) kernel.release(s)
  }

  let prototypeKey: string | null = null
  if (info.shapeHandle) {
    // Get un-located shape for dedup (located with identity = remove location)
    try {
      const unlocated = kernel.located(info.shapeHandle, IDENTITY_MATRIX)
      prototypeKey = String(kernel.hashCode(unlocated, 2147483647))
      kernel.release(unlocated)
    } catch {
      // Fallback: use shapeHandle hash directly (less accurate dedup)
      prototypeKey = String(kernel.hashCode(info.shapeHandle, 2147483647))
    }
  }

  // For single-solid leaf parts, also try STEP-parsed color as fallback
  const finalColor = color ?? (solidColors[ctx.idx] ?? null)
  ctx.idx++

  return {
    labelPath: path,
    name,
    isAssembly: false,
    isComponent: info.isComponent,
    shapeHandle: info.shapeHandle,
    prototypeKey,
    color: finalColor,
    children: [],
  }
}

/** Recursively release all shapeHandle values in an assembly tree. */
export function releaseAssemblyTree(kernel: BrepEngineApi, nodes: AssemblyPartNode[]): void {
  for (const node of nodes) {
    if (node.shapeHandle) kernel.release(node.shapeHandle as unknown as BrepHandle)
    if (node.children.length > 0) releaseAssemblyTree(kernel, node.children)
  }
}

/** Collect all leaf (non-assembly) nodes from an assembly tree. */
export function collectLeafParts(nodes: AssemblyPartNode[]): AssemblyPartNode[] {
  const leaves: AssemblyPartNode[] = []
  function walk(node: AssemblyPartNode) {
    if (node.isAssembly) {
      for (const child of node.children) walk(child)
    } else {
      leaves.push(node)
    }
  }
  for (const node of nodes) walk(node)
  return leaves
}

/**
 * 导入 BREP → ShapeHandle + Mesh。
 */
export async function importBrepToMesh(
  brepData: string,
  deflection?: MeshDeflectionOptions,
): Promise<WasmImportResult> {
  const kernel = (await initOcctWasm()) as unknown as OcctKernel
  const shape = kernel.fromBREP(brepData)

  const eff = computeEffectiveDeflection(kernel as unknown as BrepEngineApi, shape as unknown as BrepHandle, deflection)
  const mesh = kernel.meshShape(shape, { linearDeflection: eff.linearDeflection, angularDeflection: eff.angularDeflection })

  return {
    shapeHandle: shape,
    meshes: [{
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
    }],
    meshWithGroups: mesh,
  }
}

/**
 * Mesh → STEP 导出：从三角网格重建 STEP 实体。
 * 参考 occt-wasm/examples/stl2step.mjs 的实现模式。
 *
 * @param positions 顶点数组 [x0,y0,z0, x1,y1,z1, ...]
 * @param indices   索引数组 [i0,i1,i2, i3,i4,i5, ...]
 * @param tolerance 缝合容差（mm，默认 0.01）
 * @returns STEP 文件内容字符串
 */
export function meshesToStep(
  positions: Float32Array,
  indices: Uint32Array,
  tolerance = 0.01,
): string {
  const kernel = getKernel()
  const faces: ShapeHandle[] = []
  let solid: ShapeHandle | null = null

  try {
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3
      const ib = indices[i + 1] * 3
      const ic = indices[i + 2] * 3
      const face = kernel.buildTriFace(
        { x: positions[ia], y: positions[ia + 1], z: positions[ia + 2] },
        { x: positions[ib], y: positions[ib + 1], z: positions[ib + 2] },
        { x: positions[ic], y: positions[ic + 1], z: positions[ic + 2] },
      )
      faces.push(face)
    }

    solid = kernel.sewAndSolidify(faces, tolerance)
    const unified = kernel.unifySameDomain(solid)
    kernel.release(solid)
    solid = unified
    return kernel.exportStep(solid)
  } finally {
    if (solid !== null) kernel.release(solid)
    for (const f of faces) kernel.release(f)
  }
}

/** 释放一个 shape handle。 */
export function releaseShape(handle: ShapeHandle): void {
  if (kernelInstance) kernelInstance.release(handle)
}

/** 导出类型供外部使用 */
export type { OcctKernel, ShapeHandle, Mesh, EdgeData, SurfaceKind, CurveKind, BoundingBox, Vec3, XCAFDocument, LabelInfo, LabelTag }
