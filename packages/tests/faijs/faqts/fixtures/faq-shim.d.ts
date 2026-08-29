/**
 * Ambient declarations for the faits（faq `.ts` 脚本）fixture's bare specifier.
 *
 * mount-plate.ts 演示 faits 形态：以 `@faicad/faq` 裸说明符导入 cad——该裸名
 * 由宿主 rewrite 钩子改写（faqts.test.ts 的 HOST_REWRITE），并非真实 npm 包。
 * 本文件让 tests 包的 typecheck 能解析该 fixture（运行时不参与，rewrite 处理）。
 */
declare module '@faicad/faq' {
  import type { Shape } from '@faicad/faijs-core/mesh/types'
  export const cad: {
    box: (opts: { size: [number, number, number] }) => Shape
    cylinder: (opts: { radius: number; height: number; center?: [number, number, number] }) => Shape
    translate: (shape: Shape, offset: [number, number, number]) => Shape
    scale: (shape: Shape, factor: number) => Shape
    union: (...shapes: Shape[]) => Shape
  }
  export type { Shape }
}

declare module '@faicad/faq/sdk' {
  import type { Shape } from '@faicad/faijs-core/mesh/types'
  export type { Shape }
}
