/**
 * Platform Result face — the first-party Result implementation.
 *
 * 2026-09-25 core-decouple Phase 1：从「vendored 投影」（旧 `export * from
 * '@faicad/faijs-brepjs/core/result.js'`）改为 core 第一方模块 `result/result.ts`
 * （同源复制，签名不变）。`@faicad/faijs/api/result` 深路径保持可用
 * （fcstd 等下游按此 import）。
 */
export * from '../result/result'
