/**
 * @faicad/faijs/compat subpath — the BREP-TS compatible surface (flat shape).
 *
 * Libraries written against the upstream brepjs API switch their imports from
 * `'brepjs'` to `'@faicad/faijs'`; for a 1:1 specifier swap they can instead
 * flat-import the brepjs-morph names via this subpath
 * (`'@faicad/faijs/compat'`), which re-exports the whole compat module that the
 * top-level `compat` namespace also exposes.
 *
 * 与顶层 `@faicad/faijs` 同一份实现（packages/core/src/api/compat）：
 * 顶层 compat 是命名字空间，本子路径是扁平形态，供第三方库逐函数 import。
 */
export * from '@faicad/faijs-core/api/compat'