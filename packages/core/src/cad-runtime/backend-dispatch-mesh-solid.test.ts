/**
 * backend-dispatch — 网格链输入的静态门禁（方案 2026-10-01 §3.4）
 *
 * "网格链输入"= 网格实体（`meshSolid`）或网格链面（`meshFace`，Phase 3 的
 * `sketchOnFace` 产物）——两者都是近似链上的构造中几何，都要由声明的网格后端读懂，
 * 所以走同一道门禁。
 *
 * 三条规则在这里被钉住（全部是"执行前判定、无运行时回退"）：
 *
 * 1. **`meshEngines` 缺省 = `['manifold']`**：不声明的 op 的 mesh 实现跑在内置
 *    `mesh/`（manifold CSG）上，它拿不到网格实体句柄——拿网格实体喂它必须静态报错
 *    （`E_MESH_SOLID_UNSUPPORTED`），绝不偷偷换一个能跑的后端。
 * 2. **链不可混**：网格链几何不得与链外几何（BREP 实体 / 裸网格）同处一次调用。
 *    任一侧的结局都是隐式降级——走 manifold 丢掉网格实体的身份与近似拓扑，走网格
 *    后端拿不到对侧句柄——故直接报错（`E_MESH_SOLID_MIXED`）。
 * 3. **brep 模式下的网格实体**报 `E_BREP_UNSUPPORTED`，不是网格门禁：网格零件按
 *    定义没有精度链，这才是它的第一条事实。
 *
 * 门禁读的是**已装配后端对象自身**的 id（`kernel.meshSolid.id`）而不是注册表的另一份
 * 快照——本文件因此直接 `configureBackends`，装配什么就验什么。
 */
import { describe, it, expect } from 'vitest'
import { configureBackends, CONTRACT_VERSION, MeshUnsupportedError, type Backends } from '../runtime-state'
import { attachMeshFace, attachMeshSolid, ensureSlot, solid } from '../shape'
import { dispatchPath, DEFAULT_MESH_ENGINES } from './backend-dispatch'
import { dualOpMetaOf } from '../define-op'
import { translate, rotate_euler, scale, scale3d } from '../api/transform'
import { shell } from '../api/shell'
import { fillet } from '../api/fillet'
import { chamfer } from '../api/chamfer'
import { extrude } from '../api/extrude'
import { sketchOnFace } from '../api/sketch-on-face'
import { linearPattern } from '../api/pattern'
import { circularPattern, gridPattern, rectangularPattern, mirrorJoin, mirror, clone } from '../api/replicate'
import type { Shape } from '../mesh/types'

/** 一个能被识别为几何输入的最小 mesh 形状。 */
const mesh = (): Shape => solid({ positions: new Float32Array(9), indices: new Uint32Array(3) })

/** 网格实体形状（槽里挂句柄身份）。 */
const meshSolidShape = (): Shape => {
  const s = mesh()
  attachMeshSolid(s, { h: 'mesh-solid' })
  return s
}

/** 网格链面形状（`sketchOnFace` 网格分支的产物形态）。 */
const meshFaceShape = (): Shape => {
  const s = mesh()
  attachMeshFace(s, { h: 'mesh-face' })
  return s
}

/** BREP 链形状（槽里挂 BREP 句柄）。 */
const brepShape = (): Shape => {
  const s = mesh()
  ensureSlot(s).solid = { h: 'brep-solid' }
  return s
}

/**
 * 装配 backends。
 *
 * @param mode - execution mode.
 * @param meshBackendId - the assembled mesh backend id (null = none assembled).
 * @returns the backends record.
 */
function makeBackends(mode: 'auto' | 'brep' | 'mesh', meshBackendId: string | null): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: { methods: [] } },
    kernel: {
      brep: {},
      csg: undefined,
      sdf: undefined,
      meshSolid: meshBackendId === null ? undefined : { id: meshBackendId },
    },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

/** 有 mesh + brep 两个实现的 op 声明。 */
const dualImpls = (meshEngines?: readonly string[]) => ({
  mesh: () => undefined,
  brep: () => undefined,
  name: 'test-op',
  ...(meshEngines ? { meshEngines } : {}),
})

describe('dispatchPath：网格实体输入的静态门禁', () => {
  it('缺省 meshEngines = [\'manifold\']：网格实体喂给不声明的 op → E_MESH_SOLID_UNSUPPORTED', () => {
    expect(DEFAULT_MESH_ENGINES).toEqual(['manifold'])
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(() => dispatchPath([meshSolidShape()], dualImpls())).toThrow(/E_MESH_SOLID_UNSUPPORTED/)
  })

  it('声明的 meshEngines 命中当前网格后端 → 放行（返回 mesh）', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(dispatchPath([meshSolidShape()], dualImpls(['brepkit']))).toBe('mesh')
  })

  it('声明的 meshEngines 不命中（后端换了）→ 仍然静态报错', () => {
    configureBackends(makeBackends('auto', 'some-other-backend'))
    expect(() => dispatchPath([meshSolidShape()], dualImpls(['brepkit']))).toThrow(/E_MESH_SOLID_UNSUPPORTED/)
  })

  it('未装配网格后端 → 静态报错（装配事实，不是运行时降级点）', () => {
    configureBackends(makeBackends('auto', null))
    expect(() => dispatchPath([meshSolidShape()], dualImpls(['brepkit']))).toThrow(/E_MESH_SOLID_UNSUPPORTED/)
  })

  it('mode=\'mesh\' 不豁免门禁：强制 mesh 也不等于后端就能处理网格实体', () => {
    configureBackends(makeBackends('mesh', 'brepkit'))
    expect(() => dispatchPath([meshSolidShape()], dualImpls())).toThrow(/E_MESH_SOLID_UNSUPPORTED/)
  })

  it('网格实体 + BREP 实体混进同一次调用 → E_MESH_SOLID_MIXED（不是几何失败）', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(() => dispatchPath([meshSolidShape(), brepShape()], dualImpls(['brepkit'])))
      .toThrow(/E_MESH_SOLID_MIXED/)
  })

  it('网格实体 + 裸网格混进同一次调用 → 同样 E_MESH_SOLID_MIXED', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(() => dispatchPath([meshSolidShape(), mesh()], dualImpls(['brepkit'])))
      .toThrow(/E_MESH_SOLID_MIXED/)
  })

  it('两个网格实体（无链外几何）→ 放行', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(dispatchPath([meshSolidShape(), meshSolidShape()], dualImpls(['brepkit']))).toBe('mesh')
  })

  it('brep 模式下的网格实体 → E_BREP_UNSUPPORTED（比网格门禁更贴切）', () => {
    configureBackends(makeBackends('brep', 'brepkit'))
    let caught: unknown
    try { dispatchPath([meshSolidShape()], dualImpls(['brepkit'])) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('E_BREP_UNSUPPORTED')
    expect((caught as Error).message).not.toContain('E_MESH_SOLID')
  })

  it('无网格实体输入 → 门禁完全不参与（纯 mesh 输入照旧）', () => {
    configureBackends(makeBackends('auto', null))
    expect(dispatchPath([mesh()], dualImpls())).toBe('mesh')
  })

  it('门禁抛的是 MeshUnsupportedError（与另两条 mesh 路径拒绝同归属，便于宿主归类）', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    let caught: unknown
    try { dispatchPath([meshSolidShape()], dualImpls()) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(MeshUnsupportedError)
  })
})

describe('dispatchPath：网格链面输入走同一道门禁（Phase 3）', () => {
  it('声明的 meshEngines 命中 → 放行（返回 mesh）', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(dispatchPath([meshFaceShape()], dualImpls(['brepkit']))).toBe('mesh')
  })

  it('缺省 meshEngines = [\'manifold\'] → E_MESH_SOLID_UNSUPPORTED（面同样只归网格后端）', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(() => dispatchPath([meshFaceShape()], dualImpls())).toThrow(/E_MESH_SOLID_UNSUPPORTED/)
  })

  it('未装配网格后端 → 静态报错', () => {
    configureBackends(makeBackends('auto', null))
    expect(() => dispatchPath([meshFaceShape()], dualImpls(['brepkit']))).toThrow(/E_MESH_SOLID_UNSUPPORTED/)
  })

  it('网格链面 + BREP 实体 → E_MESH_SOLID_MIXED', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    expect(() => dispatchPath([meshFaceShape(), brepShape()], dualImpls(['brepkit'])))
      .toThrow(/E_MESH_SOLID_MIXED/)
  })

  it('brep 模式下的网格链面 → E_BREP_UNSUPPORTED（面也没有精度链）', () => {
    configureBackends(makeBackends('brep', 'brepkit'))
    let caught: unknown
    try { dispatchPath([meshFaceShape()], dualImpls(['brepkit'])) } catch (e) { caught = e }
    expect((caught as Error).message).toContain('E_BREP_UNSUPPORTED')
    expect((caught as Error).message).not.toContain('E_MESH_SOLID')
  })

  it('身份槽互斥：同时挂 BREP 句柄与网格链面句柄 → E_SHAPE_SLOT_EXCLUSIVE', () => {
    configureBackends(makeBackends('auto', 'brepkit'))
    const both = mesh()
    attachMeshFace(both, { h: 'mesh-face' })
    ensureSlot(both).solid = { h: 'brep-solid' }
    expect(() => dispatchPath([both], dualImpls(['brepkit']))).toThrow(/E_SHAPE_SLOT_EXCLUSIVE/)
  })

  it('身份槽互斥：网格实体与网格链面同挂一形 → 写入侧即拒（attachMeshSolid 抛错）', () => {
    const s = meshFaceShape()
    expect(() => attachMeshSolid(s, { h: 'mesh-solid' })).toThrow(/E_SHAPE_SLOT_EXCLUSIVE/)
  })
})

/**
 * 真实 op 的 `meshEngines` 声明（用的是 op 自己的 `DUAL_OP_META`，不是复刻一份）。
 *
 * 这一组存在的理由：门禁的通用性已由上面的合成 op 用例钉住，但"某个真实 op 忘了
 * 声明"是另一类缺陷——它不会让门禁失效，而是让**该 op 的 mesh 实现在网格实体上
 * 不可达**（后果取决于实现：变换族会退回顶点烘焙，把网格零件静默降级成裸网格）。
 * 故对每个提供网格实体实现的 op，逐个钉住"声明了 brepkit"+"换后端即静态报错"。
 */
describe('真实 op：网格实体实现的 meshEngines 声明', () => {
  const ops: Record<string, unknown> = {
    translate,
    rotate_euler,
    scale,
    scale3d,
    shell,
    fillet,
    chamfer,
    extrude,
    sketchOnFace,
    linearPattern,
    circularPattern,
    gridPattern,
    rectangularPattern,
    mirrorJoin,
    mirror,
    clone,
  }

  for (const [name, op] of Object.entries(ops)) {
    it(`${name}: 声明 brepkit，且当前后端换成 manifold 时静态报错（不静默降级）`, () => {
      const meta = dualOpMetaOf(op)
      expect(meta, `${name} must be a defineOp product`).toBeDefined()
      expect(meta!.mesh, `${name} must carry a mesh implementation`).toBeTypeOf('function')
      expect(meta!.meshEngines, `${name} must declare its mesh backend`).toContain('brepkit')

      configureBackends(makeBackends('auto', 'manifold'))
      expect(() => dispatchPath([meshSolidShape()], meta!)).toThrow(/E_MESH_SOLID_UNSUPPORTED/)

      configureBackends(makeBackends('auto', 'brepkit'))
      expect(dispatchPath([meshSolidShape()], meta!), `${name} passes with the declared backend`).toBe('mesh')
    })
  }
})
