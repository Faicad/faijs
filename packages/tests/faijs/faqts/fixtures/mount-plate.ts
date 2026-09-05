/**
 * mount-plate.ts — faits（faq 的 `.ts` 全 TS 脚本）fixture
 *
 * 一个"任意 TypeScript"的 CAD 脚本，演示 faits（faq 的 `.ts` 脚本）的形态：
 * - 完整 TS（局部类型 + 控制流），而非 `.faij` 受限子集
 * - 整段一次执行（不建 IR、不逐语句、不接入 timeline）
 * - 输出**显式声明**：export default 对象（无 DAG 自动推导）
 * - 共享 `cad` API 与 Shape 契约（与 faq 侧互通）
 *
 * 用 `@faicad/faq` 裸说明符导入 `cad`；宿主凭 rewrite 钩子把裸名改写为
 * 本仓库可解析模块（浏览器宿主用 importmap）。仅用同步 op（box/cylinder/
 * translate/scale），不需要 OCCT/manifold 初始化，测试保持快速且确定。
 */

import { cad } from '@faicad/faq'
import type { Shape } from '@faicad/faq/sdk'

function makePlate(size: number): Shape {
  const plate = cad.box({ width: size, depth: size, height: 4, centered: true })
  return plate
}

function makeBoss(): Shape {
  return cad.cylinder({ radius: 6, height: 10, center: [0, 0, 2] })
}

const multi = 2
const plate = makePlate(10 * multi)
const boss = makeBoss()
const plateWithBoss = cad.translate(boss, [0, 0, 0])
const moved = cad.translate(plate, [0, 0, 12])

// 显式输出声明：作者明确列出需要对外暴露的终端产出（无 IR → 引擎不推导）
export { plate, boss, moved }
export default { plate, boss, moved, tag: 'mount-plate-v1', multi }