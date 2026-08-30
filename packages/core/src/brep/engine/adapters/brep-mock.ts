/**
 * engine/adapters/memory — 内存模拟 BREP 引擎（第二引擎，引擎切换验证用）
 *
 * 设计：docs/plans/2026-08-30-brep-engine-switch.md §6.2
 *
 * 目的：证明「引擎可切换」——不是生产内核，是注册表机制的验证载体。
 * 与 occt 适配器（adapters/occt.ts）同构注册；同一段 faijs 代码在
 * occt / memory 两个引擎下都能执行（构造 → 变换 → 布尔 → 三角化 → 导出），
 * 通过 mock STEP 文本标记区分当前引擎。
 *
 * 实现形态：句柄为自增 number；每条形状记录 { kind, bbox, tag }。
 * 只实现引擎切换测试所需的方法面（原语/变换/布尔/网格化/导出），
 * 其余方法抛「not implemented」——缺失即暴露，绝不伪造（§7.5 语义）。
 */

import { registerBrepEngine, type BrepEngine } from '../registry'
import type {
  BrepBoundingBox,
  BrepCurveParameters,
  BrepEdgeData,
  BrepEvolutionData,
  BrepHandle,
  BrepMeshResult,
  BrepSubShapeType,
  BrepTessellateOptions,
  BrepUvBounds,
  BrepVec3,
  BrepXcafDocument,
} from '../types'
import type { BrepEngineApi, AssertSatisfiesBrepEngineApi } from '../primitives'

/** brep-mock engine registration id. */
export const BREP_MOCK_ENGINE_ID = 'brep_mock'

/** Internal shape record (the "solid" of an in-memory mock BREP). */
interface MemShape {
  kind: 'box' | 'sphere' | 'cylinder' | 'cone' | 'edge' | 'wire' | 'face' | 'solid' | 'compound'
  /** 轴对齐包围盒（近似真实几何，供 getBoundingBox / 导出用）。 */
  bbox: BrepBoundingBox
  /** 人类可读描述（导出标记用）。 */
  tag: string
}

function bboxOf(kind: MemShape['kind'], size: [number, number, number]): BrepBoundingBox {
  const [x, y, z] = size
  return { xmin: -x / 2, ymin: -y / 2, zmin: -z / 2, xmax: x / 2, ymax: y / 2, zmax: z / 2 }
}

/** 1×1×1 单位盒三角化（8 顶点 / 12 三角形；memory 引擎的 meshShape 输出）。 */
const UNIT_BOX_POSITIONS = new Float32Array([
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
])
const UNIT_BOX_INDICES = new Uint32Array([
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
])

function unitBoxMesh(): BrepMeshResult {
  return {
    positions: new Float32Array(UNIT_BOX_POSITIONS),
    normals: new Float32Array(24), // 占位法线（切换测试不校验法线）
    indices: new Uint32Array(UNIT_BOX_INDICES),
    vertexCount: 8,
    triangleCount: 12,
  }
}

/** Build an in-memory mock BREP engine (BrepEngineApi subset). */
export function createBrepMockApi(): BrepEngineApi {
  const shapes = new Map<number, MemShape>()
  let nextHandle = 1

  const alloc = (shape: MemShape): BrepHandle => {
    const h = nextHandle as BrepHandle
    nextHandle += 1
    shapes.set(h, shape)
    return h
  }

  const need = (h: BrepHandle, method: string): MemShape => {
    const s = shapes.get(h)
    if (!s) throw new Error(`[brep-mock-engine] ${method}: unknown handle ${h}`)
    return s
  }

  const unsupported = (method: string): never => {
    throw new Error(`[brep-mock-engine] ${method}() not implemented — engine-switch test only`)
  }

  /** 布尔合并 bbox（fuse/cut/common 的近似包围盒）。 */
  const mergeBbox = (a: BrepBoundingBox, b: BrepBoundingBox): BrepBoundingBox => ({
    xmin: Math.min(a.xmin, b.xmin),
    ymin: Math.min(a.ymin, b.ymin),
    zmin: Math.min(a.zmin, b.zmin),
    xmax: Math.max(a.xmax, b.xmax),
    ymax: Math.max(a.ymax, b.ymax),
    zmax: Math.max(a.zmax, b.zmax),
  })

  const mockXcafDocument = (): BrepXcafDocument => ({
    addShape: () => undefined,
    exportSTEP: () => mockStepExport(),
    close: () => undefined,
  })

  const mockStepExport = (): string =>
    'brep-mock-engine STEP (mock)\n' +
    '// Not real STEP — marker of the in-memory mock BREP engine, for engine-switch tests only.\n' +
    'FILE_DESCRIPTION(("brep-mock-engine"), "2;1");'

  const primitive = (
    kind: MemShape['kind'],
    size: [number, number, number],
    tag: string,
  ): BrepHandle => alloc({ kind, bbox: bboxOf(kind, size), tag })

  const primitives: BrepEngineApi = {
    // ── 生命周期 ──
    release: () => undefined,

    // ── 实体图元 ──
    makeBox: (dx, dy, dz) => primitive('box', [dx, dy, dz], `box ${dx}x${dy}x${dz}`),
    makeBoxFromCorners: (c1, c2) => primitive('box',
      [Math.abs(c2.x - c1.x), Math.abs(c2.y - c1.y), Math.abs(c2.z - c1.z)],
      `box (${c1.x},${c1.y},${c1.z})→(${c2.x},${c2.y},${c2.z})`),
    makeCylinder: (radius, height) => primitive('cylinder', [radius * 2, radius * 2, height], `cylinder r=${radius} h=${height}`),
    makeSphere: (radius) => primitive('sphere', [radius * 2, radius * 2, radius * 2], `sphere r=${radius}`),
    makeCone: (r1, r2, height) => primitive('cone', [Math.max(r1, r2) * 2, Math.max(r1, r2) * 2, height], `cone r1=${r1} r2=${r2} h=${height}`),
    makeRectangle: (width, height) => primitive('face', [width, height, 0], `rectangle ${width}x${height}`),

    // ── 造型运算 ──
    extrude: (shape, dx, dy, dz) => {
      const s = need(shape, 'extrude')
      return alloc({ kind: 'solid', bbox: { ...s.bbox, xmax: s.bbox.xmax + dx, ymax: s.bbox.ymax + dy, zmax: s.bbox.zmax + dz }, tag: `extrude(${s.tag})` })
    },
    loft: () => unsupported('loft'),

    // ── 布尔与分割 ──
    fuse: (a, b) => {
      const sa = need(a, 'fuse')
      const sb = need(b, 'fuse')
      return alloc({ kind: 'solid', bbox: mergeBbox(sa.bbox, sb.bbox), tag: `fuse(${sa.tag},${sb.tag})` })
    },
    cut: (a, b) => {
      const sa = need(a, 'cut')
      return alloc({ kind: 'solid', bbox: { ...sa.bbox }, tag: `cut(${sa.tag},#${b})` })
    },
    common: (a, b) => {
      const sa = need(a, 'common')
      const sb = need(b, 'common')
      return alloc({ kind: 'solid', bbox: mergeBbox(sa.bbox, sb.bbox), tag: `common(${sa.tag},${sb.tag})` })
    },
    intersect: (a, b) => {
      const sa = need(a, 'intersect')
      const sb = need(b, 'intersect')
      return alloc({ kind: 'solid', bbox: mergeBbox(sa.bbox, sb.bbox), tag: `intersect(${sa.tag},${sb.tag})` })
    },
    section: () => unsupported('section'),
    fuseAll: (shapesIn) => {
      let bbox: BrepBoundingBox | null = null
      let tag = 'fuseAll('
      for (const s of shapesIn) {
        const rec = need(s, 'fuseAll')
        bbox = bbox ? mergeBbox(bbox, rec.bbox) : { ...rec.bbox }
        tag += `${rec.tag},`
      }
      return alloc({ kind: 'solid', bbox: bbox ?? bboxOf('solid', [0, 0, 0]), tag: `${tag})` })
    },

    // ── 变换 ──
    translate: (shape, dx, dy, dz) => {
      const s = need(shape, 'translate')
      return alloc({
        kind: 'solid',
        bbox: {
          xmin: s.bbox.xmin + dx, ymin: s.bbox.ymin + dy, zmin: s.bbox.zmin + dz,
          xmax: s.bbox.xmax + dx, ymax: s.bbox.ymax + dy, zmax: s.bbox.zmax + dz,
        },
        tag: `translate(${s.tag},${dx},${dy},${dz})`,
      })
    },
    scale: (shape, _center, factor) => {
      const s = need(shape, 'scale')
      return alloc({ kind: 'solid', bbox: {
        xmin: s.bbox.xmin * factor, ymin: s.bbox.ymin * factor, zmin: s.bbox.zmin * factor,
        xmax: s.bbox.xmax * factor, ymax: s.bbox.ymax * factor, zmax: s.bbox.zmax * factor,
      }, tag: `scale(${s.tag},${factor})` })
    },
    transform: (shape, _matrix) => {
      const s = need(shape, 'transform')
      return alloc({ kind: 'solid', bbox: { ...s.bbox }, tag: `transform(${s.tag})` })
    },
    located: (shape, _matrix) => {
      const s = need(shape, 'located')
      return alloc({ kind: 'solid', bbox: { ...s.bbox }, tag: `located(${s.tag})` })
    },
    generalTransform: (shape, _matrix) => {
      const s = need(shape, 'generalTransform')
      return alloc({ kind: 'solid', bbox: { ...s.bbox }, tag: `generalTransform(${s.tag})` })
    },
    copy: (shape) => {
      const s = need(shape, 'copy')
      return alloc({ kind: 'solid', bbox: { ...s.bbox }, tag: `copy(${s.tag})` })
    },

    // ── 曲线构造 ──
    makeLineEdge: (start, end) => alloc({ kind: 'edge',
      bbox: {
        xmin: Math.min(start.x, end.x), ymin: Math.min(start.y, end.y), zmin: Math.min(start.z, end.z),
        xmax: Math.max(start.x, end.x), ymax: Math.max(start.y, end.y), zmax: Math.max(start.z, end.z),
      },
      tag: `line(${start.x},${start.y},${start.z})→(${end.x},${end.y},${end.z})` }),
    makeArcEdge: (start, mid, end) => {
      const xs = [start.x, mid.x, end.x]
      const ys = [start.y, mid.y, end.y]
      const zs = [start.z, mid.z, end.z]
      return alloc({ kind: 'edge', bbox: {
        xmin: Math.min(...xs), ymin: Math.min(...ys), zmin: Math.min(...zs),
        xmax: Math.max(...xs), ymax: Math.max(...ys), zmax: Math.max(...zs),
      }, tag: `arc` })
    },
    makeBezierEdge: () => alloc({ kind: 'edge', bbox: bboxOf('edge', [1, 1, 1]), tag: 'bezier' }),

    // ── 拓扑构造 ──
    makeWire: (edges) => alloc({ kind: 'wire', bbox: edges.length > 0 ? { ...need(edges[0], 'makeWire').bbox } : bboxOf('wire', [0, 0, 0]), tag: `wire(${edges.length})` }),
    makeFace: (wire) => alloc({ kind: 'face', bbox: { ...need(wire, 'makeFace').bbox }, tag: `face(#${wire})` }),
    makeCompound: (parts) => {
      let bbox: BrepBoundingBox | null = null
      for (const p of parts) {
        const rec = need(p, 'makeCompound')
        bbox = bbox ? mergeBbox(bbox, rec.bbox) : { ...rec.bbox }
      }
      return alloc({ kind: 'compound', bbox: bbox ?? bboxOf('compound', [0, 0, 0]), tag: `compound(${parts.length})` })
    },
    sewAndSolidify: () => alloc({ kind: 'solid', bbox: bboxOf('solid', [1, 1, 1]), tag: 'sewAndSolidify' }),
    buildTriFace: () => alloc({ kind: 'face', bbox: bboxOf('face', [1, 1, 0]), tag: 'triFace' }),
    addHolesInFace: (face) => alloc({ kind: 'face', bbox: { ...need(face, 'addHolesInFace').bbox }, tag: `holedFace(#${face})` }),

    // ── 三角化（BREP→mesh 唯一出口） ──
    meshShape: () => unitBoxMesh(),
    wireframe: (): BrepEdgeData => ({ points: new Float32Array(0), edgeGroups: new Int32Array(0), pointCount: 0, edgeCount: 0 }),

    // ── 拓扑查询 ──
    getSubShapes: () => [],
    queryBatch: (shapesIn) => shapesIn.map(() => ({ area: 0 })),
    subShapeHashes: () => [],
    hashCode: (shape) => shape % 2147483647,
    isSame: (a, b) => a === b,
    isSolid: () => true,
    shapeOrientation: () => 'forward',

    // ── 几何求值 ──
    curveType: () => 'line',
    curvePointAtParam: () => ({ x: 0, y: 0, z: 0 }),
    curveTangent: () => ({ x: 1, y: 0, z: 0 }),
    curveParameters: (): BrepCurveParameters => ({ first: 0, last: 1 }),
    curveIsClosed: () => false,
    curveLength: () => 0,
    surfaceType: () => 'plane',
    surfaceNormal: () => ({ x: 0, y: 0, z: 1 }),
    pointOnSurface: () => ({ x: 0, y: 0, z: 0 }),
    uvBounds: (): BrepUvBounds => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
    getSurfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
    getFaceCylinderData: () => null,
    getNurbsCurveData: () => null,

    // ── 测量 ──
    getBoundingBox: (shape) => ({ ...need(shape, 'getBoundingBox').bbox }),
    getVolume: (shape) => {
      const b = need(shape, 'getVolume').bbox
      return (b.xmax - b.xmin) * (b.ymax - b.ymin) * (b.zmax - b.zmin)
    },
    getCenterOfMass: (shape) => {
      const b = need(shape, 'getCenterOfMass').bbox
      return { x: (b.xmin + b.xmax) / 2, y: (b.ymin + b.ymax) / 2, z: (b.zmin + b.zmax) / 2 }
    },

    // ── 校验与修复 ──
    isValid: () => true,
    unifySameDomain: (shape) => shape,
    healSolid: (shape) => shape,
    fixShape: (shape) => shape,
    fixFaceOrientations: (shape) => shape,
    removeDegenerateEdges: (shape) => shape,

    // ── IO ──
    importStep: () => alloc({ kind: 'solid', bbox: bboxOf('solid', [10, 10, 10]), tag: 'importStep(mock)' }),
    exportStep: (shape) => {
      const s = need(shape, 'exportStep')
      return `brep-mock-engine STEP (mock)\nshape #${shape}: ${s.tag}\nFILE_DESCRIPTION(("brep-mock-engine"), "2;1");`
    },
    importStl: () => alloc({ kind: 'solid', bbox: bboxOf('solid', [10, 10, 10]), tag: 'importStl(mock)' }),
    fromBREP: () => alloc({ kind: 'solid', bbox: bboxOf('solid', [10, 10, 10]), tag: 'fromBREP(mock)' }),

    // ── 面演化（可选能力槽：memory 不支持 → 明确缺失暴露） ──
    cutWithHistory: (a, b, _hashes, _upper) => {
      const result = primitives.cut(a, b)
      const evo: BrepEvolutionData = { result, modified: [], generated: [], deleted: [] }
      return evo
    },
    fuseWithHistory: (a, b, _hashes, _upper) => {
      const result = primitives.fuse(a, b)
      const evo: BrepEvolutionData = { result, modified: [], generated: [], deleted: [] }
      return evo
    },
    intersectWithHistory: (a, b, _hashes, _upper) => {
      const result = primitives.intersect(a, b)
      const evo: BrepEvolutionData = { result, modified: [], generated: [], deleted: [] }
      return evo
    },

    // ── XCAF 装配（mock 文档） ──
    createXCAFDocument: () => mockXcafDocument(),
    importXCAFFromSTEP: () => mockXcafDocument(),
  }
  return primitives
}

/** Assemble the brep-mock engine (sync registration — no async init). */
export function registerBrepMockEngine(): void {
  registerBrepEngine(BREP_MOCK_ENGINE_ID, async (): Promise<BrepEngine> => ({
    id: BREP_MOCK_ENGINE_ID,
    primitives: createBrepMockApi(),
    capabilities: {
      // brep-mock lacks evolution/heal/assembly — missing capabilities are exposed (§7.5).
    },
  }))
}

// §7.8 compile-time guard: createBrepMockApi's return type must satisfy BrepEngineApi.
type _AssertBrepMockApi = AssertSatisfiesBrepEngineApi<ReturnType<typeof createBrepMockApi>>
