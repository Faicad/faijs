/**
 * @faicad/faijs-cadquery/assembly — CadQuery-compatible assembly layer (node entry).
 *
 * CadQuery grammar surface (merged into the main package 2026-10-02, from the
 * former @faicad/cq-compat-assembly standalone package):
 *   import * as cq from '@faicad/faijs-cadquery'            // workplane（主包根入口）
 *   import * as asm from '@faicad/faijs-cadquery/assembly'  // 装配（本子路径）
 *
 *   let c = await asm.constraintEx('a','>Z',shapeA,'b','<Z',shapeB,'Plane')
 *   let a = asm.buildAssembly('name', [{name:'a',shape:shapeA},...], [c[0]])
 *   let solved = a.solve()            // CQ Assembly.solve()
 *   let compound = solved.toCompound() // CQ Assembly.toCompound()
 *   await asm.save(solved, 'out.step') // CQ Assembly.save()（Node 侧）
 *
 * 消费方必须使用 CadQuery solve 相关 API（solve()/toCompound()/save()），
 * 禁止直调 core 内部求解器（getSlot(compound).behavior.solveDetailed 等）。
 *
 * 本入口含 save()（import node:fs），仅供 Node；浏览器用 `./assembly/browser`。
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
export type { CqAssembly, CqAssemblyMember, CqSubshape, AssemblyAddArg } from './assembly'

export { save, importStep, load } from './save'
