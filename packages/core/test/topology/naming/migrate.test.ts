/**
 * migrate.test.ts — TopoRef V1→V2 迁移器单测（Phase 1.11，计划 §2.3）
 *
 * 覆盖：
 * - 旧 origin（part0 / 资产名）保留 + 旧 role（box:top / cylinder:lateral）删前缀
 * - 新形态（s2 origin + top role / wall:3 / gen:fillet:0 / hole:1/wall:2）不动
 * - 旧位置名（extrude:face_3）删前缀得 face_3（非法但迁移器不拦，解析时 not found）
 * - edge / vertex / derived-face 四类 kind 分派
 * - 幂等：migrate(migrate(x)) === migrate(x)
 * - 非 TopoRef 输入抛错
 */

import { describe, it, expect } from 'vitest'
import { migrateTopoRef, migrateRole } from '../../../src/topology/naming/migrate'
import type {
  DerivedFaceTopoRef,
  EdgeTopoRef,
  FaceTopoRef,
  TopoRef,
  VertexTopoRef,
} from '../../../src/topology/naming/types'

const PLANE_HINT = { kind: 'face' as const, surfaceType: 'plane' }
const EDGE_HINT = { kind: 'edge' as const, length: 10, midpoint: [0, 0, 0] as [number, number, number] }

describe('migrateRole', () => {
  it('旧形态：删 op 前缀', () => {
    expect(migrateRole('box:top')).toBe('top')
    expect(migrateRole('box:front')).toBe('front')
    expect(migrateRole('cylinder:lateral')).toBe('lateral')
    expect(migrateRole('cylinder:top')).toBe('top')
    expect(migrateRole('extrude:face_3')).toBe('face_3')
  })

  it('新形态：保留（不误伤）', () => {
    expect(migrateRole('top')).toBe('top')
    expect(migrateRole('bottom')).toBe('bottom')
    expect(migrateRole('lateral')).toBe('lateral')
    expect(migrateRole('wall:3')).toBe('wall:3')
    expect(migrateRole('wall:0')).toBe('wall:0')
    expect(migrateRole('gen:fillet:0')).toBe('gen:fillet:0')
    expect(migrateRole('imported:5')).toBe('imported:5')
    expect(migrateRole('hole:1/wall:2')).toBe('hole:1/wall:2')
    expect(migrateRole('replica[2]/wall:3')).toBe('replica[2]/wall:3')
    expect(migrateRole('splinter(top)#1')).toBe('splinter(top)#1')
  })

  it('幂等', () => {
    const cases = ['box:top', 'cylinder:lateral', 'extrude:face_3', 'top', 'wall:3', 'gen:fillet:0', 'hole:1/wall:2']
    for (const r of cases) {
      const once = migrateRole(r)
      expect(migrateRole(once), `idempotent for ${r}`).toBe(once)
    }
  })
})

describe('migrateTopoRef', () => {
  it('face：旧 origin(part0) 保留 + 旧 role(box:top) 删前缀', () => {
    const legacy: FaceTopoRef = {
      kind: 'face',
      origin: 'part0' as never,
      role: 'box:top',
      hint: PLANE_HINT,
    }
    const out = migrateTopoRef(legacy) as FaceTopoRef
    expect(out.kind).toBe('face')
    expect(out.origin).toBe('part0')
    expect(out.role).toBe('top')
    expect(out.hint).toEqual(PLANE_HINT)
  })

  it('face：旧 origin(资产名) 保留 + 旧 role(cylinder:lateral) 删前缀', () => {
    const legacy: FaceTopoRef = {
      kind: 'face',
      origin: 'MyAsset.step' as never,
      role: 'cylinder:lateral',
      hint: { kind: 'face', surfaceType: 'cylinder' },
    }
    const out = migrateTopoRef(legacy) as FaceTopoRef
    expect(out.origin).toBe('MyAsset.step')
    expect(out.role).toBe('lateral')
  })

  it('face：新形态(s2 + top) 不动（幂等）', () => {
    const fresh: FaceTopoRef = {
      kind: 'face',
      origin: 's2' as never,
      role: 'top',
      hint: PLANE_HINT,
    }
    expect(migrateTopoRef(fresh)).toEqual(fresh)
  })

  it('face：新形态(wall:3) 不误伤', () => {
    const fresh: FaceTopoRef = {
      kind: 'face',
      origin: 's3' as never,
      role: 'wall:3',
      hint: PLANE_HINT,
    }
    expect(migrateTopoRef(fresh)).toEqual(fresh)
  })

  it('face：旧位置名(extrude:face_3) 删前缀得 face_3（非法但迁移器不拦）', () => {
    const legacy: FaceTopoRef = {
      kind: 'face',
      origin: 'part0' as never,
      role: 'extrude:face_3',
      hint: PLANE_HINT,
    }
    const out = migrateTopoRef(legacy) as FaceTopoRef
    expect(out.role).toBe('face_3')
  })

  it('edge：两面 role 迁移、origin 保留', () => {
    const legacy: EdgeTopoRef = {
      kind: 'edge',
      faces: [
        { origin: 'part0' as never, role: 'box:top' },
        { origin: 'part0' as never, role: 'box:front' },
      ],
      hint: EDGE_HINT,
    }
    const out = migrateTopoRef(legacy) as EdgeTopoRef
    expect(out.faces[0]).toEqual({ origin: 'part0', role: 'top' })
    expect(out.faces[1]).toEqual({ origin: 'part0', role: 'front' })
  })

  it('edge：新形态不动', () => {
    const fresh: EdgeTopoRef = {
      kind: 'edge',
      faces: [
        { origin: 's2' as never, role: 'top' },
        { origin: 's2' as never, role: 'front' },
      ],
      hint: EDGE_HINT,
    }
    expect(migrateTopoRef(fresh)).toEqual(fresh)
  })

  it('vertex：多面 role 迁移', () => {
    const legacy: VertexTopoRef = {
      kind: 'vertex',
      faces: [
        { origin: 'part0' as never, role: 'box:top' },
        { origin: 'part0' as never, role: 'box:front' },
        { origin: 'part0' as never, role: 'box:right' },
      ],
      hint: { kind: 'vertex', position: [0, 0, 0] as [number, number, number] },
    }
    const out = migrateTopoRef(legacy) as VertexTopoRef
    expect(out.faces.map((f) => f.role)).toEqual(['top', 'front', 'right'])
  })

  it('derived-face：between 两面 role 迁移', () => {
    const legacy: DerivedFaceTopoRef = {
      kind: 'derived-face',
      op: 'fillet',
      between: [
        { origin: 'part0' as never, role: 'box:top' },
        { origin: 'part0' as never, role: 'box:front' },
      ],
      hint: { kind: 'derived-face', normalA: [0, 0, 1] as [number, number, number], normalB: [0, 1, 0] as [number, number, number] },
    }
    const out = migrateTopoRef(legacy) as DerivedFaceTopoRef
    expect(out.between[0].role).toBe('top')
    expect(out.between[1].role).toBe('front')
  })

  it('幂等：migrate(migrate(x)) === migrate(x) 全类', () => {
    const cases: TopoRef[] = [
      { kind: 'face', origin: 'part0' as never, role: 'box:top', hint: PLANE_HINT },
      { kind: 'face', origin: 's2' as never, role: 'top', hint: PLANE_HINT },
      {
        kind: 'edge',
        faces: [
          { origin: 'part0' as never, role: 'box:top' },
          { origin: 'part1' as never, role: 'cylinder:lateral' },
        ],
        hint: EDGE_HINT,
      },
      {
        kind: 'vertex',
        faces: [{ origin: 's2' as never, role: 'wall:3' }],
        hint: { kind: 'vertex', position: [0, 0, 0] as [number, number, number] },
      },
    ]
    for (const ref of cases) {
      const once = migrateTopoRef(ref)
      expect(migrateTopoRef(once), `idempotent for kind=${ref.kind}`).toEqual(once)
    }
  })

  it('非 TopoRef 输入抛错', () => {
    expect(() => migrateTopoRef(null)).toThrow()
    expect(() => migrateTopoRef(undefined)).toThrow()
    expect(() => migrateTopoRef('not a ref')).toThrow()
    expect(() => migrateTopoRef({ kind: 'bogus' })).toThrow()
    expect(() => migrateTopoRef({})).toThrow()
  })
})