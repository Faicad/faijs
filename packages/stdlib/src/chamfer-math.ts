/**
 * chamfer-math — 倒角纯函数（无 wasm 依赖，T-A1 / §3.5）
 *
 * twoDistances 的几何换算：occt-wasm 只暴露 `AddDA(Dis, Ang, E, F)`，双距必须换算
 * 成「沿参考面距离 + 角度」。换算基于边垂直截面内的三角形关系（§3.5）：
 *
 *   材料侧二面角 β（凸棱 β < 180；凹棱 β >= 180 → 不支持，抛 E_CLAMBER_REFLEX）
 *   参考面 F（内核 TopExp 枚举序第一个含该边的面）上截距 dF，另一面 O 上截距 dO
 *   倒角面与 F 的夹角 θ。正弦定理：dO/sin θ = dF/sin(β+θ)
 *   → dO = dF·sin θ / sin(β+θ)；反解 θ = atan2(dO·sin β, dF − dO·cos β)
 *
 * 本模块只做纯数值（不碰内核），供 chamferBrep 与 T-A1 复用。
 */

/**
 * 由两相邻面外法向的夹角（γ，弧度）求材料侧二面角 β（弧度）。
 *
 * @param normalAngleRad - γ = acos(clamp(n1·n2))，两外法向夹角（弧度）。
 * @returns 材料侧二面角 β = π − γ（弧度；凸棱时 0 < β < π）。
 */
export function materialDihedralFromNormalAngle(normalAngleRad: number): number {
  return Math.PI - normalAngleRad
}

/**
 * 两向量点积映射到 [0, π] 的夹角（弧度）——对 acos 的 clamp 提出为纯函数。
 *
 * @param dotN - n1·n2（未归一）。
 * @returns 夹角 γ = acos(clamp(dotN, −1, 1))。
 */
export function angleBetweenNormals(dotN: number): number {
  const c = Math.max(-1, Math.min(1, dotN))
  return Math.acos(c)
}

/**
 * twoDistances → chamferDistAngle 的换算（θ 反解，§3.5）。
 *
 * @param dF - 沿参考面 F 的距离（通过 Edges → kernel选F 后与 width1/width2 对应）。
 * @param dO - 沿另一面 O 的距离。
 * @param betaRad - 材料侧二面角 β（弧度）。
 * @returns 倒角面与 F 的夹角 θ（弧度）；凹棱（β ≥ π − EPS）抛错。
 */
export function chamferAngleFromDistances(dF: number, dO: number, betaRad: number): number {
  if (betaRad >= Math.PI - 1e-9) {
    throw new Error('E_CHAMFER_REFLEX_EDGE: reflex (inner) edges are not supported in V1')
  }
  const sinB = Math.sin(betaRad)
  const cosB = Math.cos(betaRad)
  return Math.atan2(dO * sinB, dF - dO * cosB)
}

/**
 * 反向校验：θ 代回前式，必须还原 dO（§3.5 自检表的 dO_check 行）。
 *
 * @param dF - 沿参考面的距离。
 * @param thetaRad - 换算得到的倒角面与 F 的夹角。
 * @param betaRad - 材料侧二面角。
 * @returns 校验的 dO = dF·sinθ / sin(β+θ)。
 */
export function chamferCheckDO(dF: number, thetaRad: number, betaRad: number): number {
  return (dF * Math.sin(thetaRad)) / Math.sin(betaRad + thetaRad)
}