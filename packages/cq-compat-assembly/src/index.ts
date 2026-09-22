/**
 * @faicad/cq-compat-assembly — CadQuery-compatible assembly layer for faijs.
 *
 * CadQuery grammar surface:
 *   import * as cq from '@faicad/cq-compat'          // workplane（主包）
 *   import * as asm from '@faicad/cq-compat-assembly' // 装配（本包）
 *
 *   let c = await asm.constraintEx('a','>Z',shapeA,'b','<Z',shapeB,'Plane')
 *   let a = asm.buildAssembly('name', [{name:'a',shape:shapeA},...], [c[0]])
 *   let solved = a.solve()            // CQ Assembly.solve()
 *   let compound = solved.toCompound() // CQ Assembly.toCompound()
 *   await asm.save(solved, 'out.step') // CQ Assembly.save()（Node 侧）
 *
 * 消费方必须使用 CadQuery solve 相关 API（solve()/toCompound()/save()），
 * 禁止直调 core 内部求解器（getSlot(compound).behavior.solveDetailed 等）。
 */

export {
  faceRef,
  pointRef,
  axisRef,
  constraint,
  constraintEx,
  buildAssembly,
  Color,
} from './assembly'
export type { CqAssembly, CqAssemblyMember } from './assembly'

export { save } from './save'
