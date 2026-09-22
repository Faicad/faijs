/**
 * migrate.ts — TopoRef V1→V2 迁移器（计划 §2.3，Phase 1.11）
 *
 * Phase 1.6/1.7 换型后，存量 `.fai.js` / 3d_editor 场景里的 TopoRef 字面量仍是旧形态：
 * - `role` 带 op 前缀（`'box:top'` / `'cylinder:lateral'` / `'extrude:face_3'`）
 * - `origin` 是 PartName / 资产名（`'part0'` / `'MyAsset.step'`），非 StmtId
 *
 * 本迁移器是**纯函数**，只处理能纯函数判定的部分：
 * - **role**：删 op 前缀（`'box:top'` → `'top'`）。用 `parseRoleName` 判定——
 *   解析成功即为新形态（`'top'` / `'wall:3'` / `'gen:fillet:0'` / `'hole:1/wall:2'`），
 *   保留；解析失败即为旧形态，按 `/^[a-zA-Z_]+:/` 删前缀。`wall:`/`hole:`/`gen:`/
 *   `replica[`/`splinter(`/`imported:` 等合法新前缀不会被误删（parseRoleName 已认）。
 * - **origin**：**保留原值**。旧 origin（PartName / 资产名）→ 新 origin（StmtId）的映射
 *   需要场景上下文（part0 是哪条语句的输出），纯函数无从得知 ⇒ 由 3d_editor 载入场景时
 *   用自己的 `partToStmt` 映射完成。本函数只保证 role 迁移 + 幂等。
 *
 * **幂等**：`migrateRole` 二次不动——第一次删前缀后 `parseRoleName` 成功，第二次保留。
 *
 * **旧位置名**（`'extrude:face_3'`）删前缀得 `'face_3'`——这不是合法 RoleName，
 * 解析时会 `E_TOPO_NOT_FOUND`。这是**正确行为**（那些名字本就违反 R3、抗重放能力为零），
 * 迁移器**报告而非伪造**（§2.3 警告：迁移器只处理数据，不处理行为）。
 *
 * 结构守卫：输入需有合法 `kind` 字段，否则抛错——绝不静默透传残缺引用。
 */

import { parseRoleName } from './role-name'
import type {
  DerivedFaceTopoRef,
  EdgeTopoRef,
  FaceTopoRef,
  RoleQualifier,
  TopoRef,
  VertexTopoRef,
} from './types'

/** 旧形态 op 前缀：`box:` / `cylinder:` / `extrude:` 等（字母/下划线 + 冒号）。 */
const LEGACY_OP_PREFIX = /^[a-zA-Z_]+:/

/**
 * 迁移单个 role 串：新形态保留，旧形态删 op 前缀。
 *
 * @param role - the role string to migrate (may be legacy `'box:top'` or new `'top'`/`'wall:3'`).
 * @returns the migrated role string (new shape, idempotent).
 */
export function migrateRole(role: string): string {
  if (parseRoleName(role) !== null) return role
  const m = role.match(LEGACY_OP_PREFIX)
  if (m) return role.slice(m[0].length)
  return role
}

/** 迁移 RoleQualifier：role 迁移，origin 保留（纯函数不映射，见文件头注）。 */
function migrateQualifier(q: RoleQualifier): RoleQualifier {
  return { origin: q.origin, role: migrateRole(q.role) }
}

/**
 * 迁移 TopoRef V1→V2（纯函数、幂等）。
 *
 * @param input - 任意值（结构守卫失败抛错）。
 * @returns 迁移后的 TopoRef（role 已删 op 前缀；origin 保留原值待 3d_editor 映射）。
 * @throws {Error} 当 `input` 不是合法 TopoRef 结构时。
 */
export function migrateTopoRef(input: unknown): TopoRef {
  if (typeof input !== 'object' || input === null) {
    throw new Error('migrateTopoRef: input is not an object')
  }
  const ref = input as { kind?: unknown }
  switch (ref.kind) {
    case 'face': {
      const f = input as FaceTopoRef
      return { kind: 'face', origin: f.origin, role: migrateRole(f.role), hint: f.hint }
    }
    case 'edge': {
      const e = input as EdgeTopoRef
      return {
        kind: 'edge',
        faces: [migrateQualifier(e.faces[0]), migrateQualifier(e.faces[1])],
        hint: e.hint,
      }
    }
    case 'vertex': {
      const v = input as VertexTopoRef
      return { kind: 'vertex', faces: v.faces.map(migrateQualifier), hint: v.hint }
    }
    case 'derived-face': {
      const d = input as DerivedFaceTopoRef
      return {
        kind: 'derived-face',
        op: d.op,
        between: [migrateQualifier(d.between[0]), migrateQualifier(d.between[1])],
        hint: d.hint,
      }
    }
    default:
      throw new Error(`migrateTopoRef: unknown kind ${String(ref.kind)}`)
  }
}