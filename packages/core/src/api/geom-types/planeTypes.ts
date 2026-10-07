/**
 * Plane type definitions — immutable plain objects.
 *
 * 第一方模块（2026-09-25 core-decouple Phase 1）：复制自 brepjs
 * `src/core/planeTypes.ts`（同源复制，签名不变）。
 */

import type { Vec3 } from './types';

/** Immutable plane defined by origin and three orthogonal direction vectors. */
export interface Plane {
  readonly origin: Vec3;
  readonly xDir: Vec3;
  readonly yDir: Vec3;
  readonly zDir: Vec3;
}

/**
 * Named standard planes.
 *
 * Axis pairs (`'XY'`, `'YZ'`, …) and view names (`'front'`, `'top'`, …)
 * are both supported. The axis-pair order determines the normal direction.
 */
export type PlaneName =
  'XY' | 'YZ' | 'ZX' | 'XZ' | 'YX' | 'ZY' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** Accept either an explicit {@link Plane} object or a {@link PlaneName} string. */
export type PlaneInput = Plane | PlaneName;
