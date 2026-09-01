/**
 * Kernel registry facade — vendored port (layer L0 contact surface / D10).
 *
 * brepjs `src/kernel/index.ts`, trimmed to the faijs-compatible surface
 * (see docs/plans/2026-09-01-layered-api-architecture.md §D10 / §D8):
 *
 * - `getKernel()` is a **frozen read-only reader**: it is bound once at
 *   assembly time and never switches at runtime. The runtime-switching
 *   `withKernel` and the three-tier `init()` WASM fallback are both cut
 *   (D10 — faijs already runs the same philosophy in
 *   `brep/engine/registry.ts`'s `freezeEngineRegistries()`).
 * - The single occt-wasm module instance is injected through the faijs
 *   `initOcctWasm` chain (D10): the faijs L3 bridge builds an
 *   {@link OcctWasmAdapter} over that same instance and registers it here.
 *   A second registration after `freezeKernels()` throws.
 *
 * Until an adapter is registered, `getKernel()` throws the same
 * "not initialized" error brepjs provides.
 */

import type { KernelAdapter } from './types.js';
import type { Kernel2DCapability } from './kernel2dTypes.js';
import type { KernelCapabilities } from './capabilities.js';
import { supportsKernel2D } from './kernel2dTypes.js';
import { currentQuality } from './quality.js';
import { supportsProjection, supportsConstraintSketch } from './types.js';
// Re-export the L0 type surface used by ported L1/L2 code (identically to brepjs).
export type {
  KernelAdapter,
  KernelMeshResult,
  DistanceResult,
  KernelInstance,
  BooleanOptions,
  ShapeType,
  SurfaceType,
  ShapeOrientation,
  MeshOptions,
  KernelShape,
  KernelType,
  StepAssemblyPart,
  ShapeEvolution,
  OperationResult,
} from './types.js';
export type {
  ProjectionCapability,
  ConstraintSketchCapability,
} from './types.js';
export type {
  KernelBooleanOps,
  KernelBuilderOps,
  KernelCore,
  KernelCurveOps,
  KernelEvolutionOps,
  KernelIOOps,
  KernelMeasureOps,
  KernelMeshOps,
  KernelModifierOps,
  KernelPrimitiveOps,
  KernelRepairOps,
  KernelSurfaceOps,
  KernelSweepOps,
  KernelTopologyOps,
  KernelTransformOps,
} from './interfaces/index.js';
export type { Kernel2DCapability } from './kernel2dTypes.js';
export type { KernelCapabilities } from './capabilities.js';
export { supportsKernel2D, supportsProjection, supportsConstraintSketch };

const _kernels = new Map<string, KernelAdapter>();
let _defaultKernelId: string | null = null;
let _cachedDefault: KernelAdapter | null = null;
let _frozen = false;

/**
 * Freeze the kernel registry (D10 冻结，同 `freezeEngineRegistries` 时机）。
 * Faijs host calls this at the end of assembly; afterwards any
 * `registerKernel` throws.
 */
export function freezeKernels(): void {
  _frozen = true;
}

/**
 * Register a kernel adapter (DIO injection: L3 bridge registers exactly one
 * 'occt-wasm' adapter over the faijs single wasm instance).
 * @throws If the registry is frozen (post-assembly, D10).
 */
export function registerKernel(id: string, adapter: KernelAdapter): void {
  if (_frozen) {
    throw new Error(
      `brepjs kernel registry frozen — cannot register '${id}' after assembly (D10)`
    );
  }
  _kernels.set(id, adapter);
  if (_defaultKernelId === null) _defaultKernelId = id;
  if (id === _defaultKernelId) _cachedDefault = adapter;
}

/**
 * Return a kernel adapter by id, or the default kernel if no id is given.
 *
 * @throws If no kernel has been registered via {@link registerKernel}
 *         (D10: bound by the faijs host at assembly, then frozen).
 */
export function getKernel(id?: string): KernelAdapter {
  if (!id && _cachedDefault) return _cachedDefault;
  const targetId = id ?? _defaultKernelId;
  if (!targetId) {
    throw new Error(
      'brepjs kernel not initialized. The faijs host must bind occt-wasm before use (D10).'
    );
  }
  const kernel = _kernels.get(targetId);
  if (!kernel) {
    throw new Error(`brepjs: kernel '${targetId}' is not registered.`);
  }
  return kernel;
}

/**
 * Return the default kernel narrowed to {@link Kernel2DCapability}.
 * @throws If the kernel does not support 2D operations.
 */
export function getKernel2D(id?: string): KernelAdapter & Kernel2DCapability {
  const kernel = getKernel(id);
  if (!supportsKernel2D(kernel)) {
    throw new Error('brepjs: current kernel does not support 2D operations.');
  }
  return kernel;
}

/** Capabilities of the active kernel (defaults to the active). */
export function getKernelCapabilities(id?: string): KernelCapabilities {
  return getKernel(id).capabilities;
}

/** Return the id of the currently active default kernel, or `null` if none. */
export function getActiveKernelId(): string | null {
  return _defaultKernelId;
}

/** Current tessellation quality tier. */
export function currentQualityTier(): string {
  return currentQuality();
}