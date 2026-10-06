/**
 * script-globals — 脚本内置全局（免 import 安全全局）的对外查询入口。
 *
 * `.fai.js` 有一组**不需要任何 import** 的裸标识符：JS 语言内置（`Math` / `JSON` /
 * `Number` / `console` / `Infinity` / `NaN` / `undefined` / `parseInt` / …）与单位常量
 * （`MM` / `INCH` / `DEGREE` / …）。脚本作者直接书写即为预期用法。
 *
 * 背景（A2）：这份名单此前只存在于 `lang/security-scanner.ts` 的实现里——既不在主导出，
 * 也没有子路径，脚本作者与编辑器只能读源码才能回答「`Math` 能不能用」。本模块把它开成
 * 一个稳定入口，供编辑器补全、实时校验与宿主侧「可用名字」提示使用。语义（两类求值方式）
 * 见 [`docs/language-design.md`](../docs/language-design.md) 的「内置全局」一节。
 *
 * 两个子路径消费者分工：
 * - **编辑器 / 宿主**：读 `S4_SAFE_GLOBALS` 做补全与校验；
 * - **不变量守卫**：`isSafeGlobalIdent` 是六处判定点共用的唯一入口，本模块只转发不复制名单。
 */

export {
  /** 脚本免 import 可用的安全全局名单（JS 语言内置 + 单位常量）。 */
  S4_SAFE_GLOBALS,
  /** 不可被脚本声明/遮蔽的单位常量名（`S4_SAFE_GLOBALS` 的子集）。 */
  RESERVED_UNIT_NAMES,
  /** 裸标识符是否为免 import 安全全局——六处判定点共用的唯一判定入口。 */
  isSafeGlobalIdent,
} from './lang/security-scanner'
