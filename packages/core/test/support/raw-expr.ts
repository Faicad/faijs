/**
 * raw-expr — 测试用「脚本面表达式片段」标记
 *
 * 若干测试自带一个 `makeStmt(...)` / `formatVal(...)` 小生成器，把 TS 值表发射成
 * 脚本代码。量纲门禁（2026-10-25 阶段 3）要求**角度槽位必须带单位**，于是生成器
 * 需要能发射 `45 * DEGREE` 这种表达式 —— 而 TS 侧算出来只是数字 45，`String(45)`
 * 会把单位丢掉。
 *
 * `RawExpr` 让 `formatVal` 原样发射文本（不加引号），语义上等于"这段已经是脚本代码"。
 * 只服务测试生成器，不进产品代码。
 */
export class RawExpr {
  constructor(readonly text: string) {}
}

/** 角度（度）→ `45 * DEGREE`。角度的裸数字在 2026-10-25 起被拒，`0` 例外照旧。 */
export function deg(n: number): RawExpr {
  return new RawExpr(`${n} * DEGREE`)
}
