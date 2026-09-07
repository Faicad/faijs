/**
 * api/assembly — 装配约束求解层（P1）
 *
 * 分层（方案 §4.1）：normalize（规范化 + face_mate 兼容）→ lower（直译降级，
 * mate/align 寄生在 concentric 上）→ entities（TopoRef → SolverEntity，双链路）
 * → solve（委派 brepjs solveConstraints）→ pose（位姿转换契约）。
 */

export * from './types'
export * from './normalize'
export * from './entities'
export * from './lower'
export * from './pose'
export * from './solve'
