/**
 * topology/naming — TopoRef 命名层（§2 of docs/plans/2026-08-31-topology-naming-port-v2.md）
 *
 * 跨历史身份层：TopoRef（纯数据、写进 .faijs）+ RoleTable（运行期、不序列化）。
 * 解析方向固定为单向：TopoRef（稳定）→ 解析器 → 当前快照的序号 FaceId/EdgeId
 * 或活 BREP 句柄。绝不反向把序号当稳定身份存进脚本。
 */

export * from './types'
export * from './geom-hint'
export * from './score'
export * from './roles'
export * from './resolve-face'
export * from './resolver'
export * from './ref-params'
export * from './capture-topo-ref'
export * from './build-naming'

// 在 M3 接入 resolve-edge/vertex/derived 时在此追加对应导出。
