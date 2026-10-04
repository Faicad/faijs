/**
 * Public types for `@faicad/faijs-viewer`.
 *
 * The viewer is the reference consumer of a project `.fai.zip` document. Its
 * v1 surface is deliberately narrow: read the container, execute the active
 * (or requested) model, and hand back tessellated mesh data plus the result's
 * failure information when execution does not complete. Structuring the meshes
 * on screen is the host's job — this return value never depends on THREE, DOM,
 * or any GL/rendering library.
 */

/** The three engine wasm URLs. All three are required by the v1 contract. */
export interface FaiZipViewerWasmOptions {
  /** URL of the occt-wasm `.wasm` (BREP execution chain engine). */
  occtUrl: string
  /** URL of the manifold-3d `.wasm` (mesh boolean/CSG engine). */
  manifoldUrl: string
  /** URL of the brepkit `brepkit_wasm_bg.wasm` (secondary BREP engine). */
  brepkitUrl: string
}

/**
 * Options for the `cad.sketch` constraint solver that real FreeCAD-converted
 * `.fai.zip` models require.
 *
 * The sketch op folds `@faicad/faijs-sketch` into the `cad` namespace and needs
 * the planegcs constraint solver. In a Node runner the solver auto-loads its
 * wasm from the installed `@salusoft89/planegcs` package; a browser host must
 * self-host the `planegcs.wasm` binary and supply its URL here. When running in
 * a browser without `planegcsUrl`, sketch-based models fail with
 * `E_SKETCHC_NO_SOLVER` (reported through `OpenFaiResult.error`).
 */
export interface SketchSolverOptions {
  /** Browser-only: URL of the self-hosted `planegcs.wasm` constraint solver. */
  planegcsUrl?: string
}

/**
 * Dynamic-loading configuration for third-party faijs libraries.
 *
 * The engine already loads a model's namespace imports on demand
 * (`autoLoadLibsFromImports`): a script like
 * `import * as gears from "@faicad/faijs-gears"` triggers a lazy
 * `libLoader.loadLib(packageName)` at execute time, and only for the libraries
 * that model actually imports. This option configures the loader the viewer
 * builds for that purpose — preset libraries (core, sketch, faijs-extra, merged
 * into the default `cad` namespace) never go through it.
 *
 * Loader dispatch follows the environment: a browser host dynamic-imports from
 * the CDN (jsDelivr), a Node host resolves installed packages. Loading or
 * version-verification failures surface as structured `E_EXECUTION`
 * (`failedAt`) on `OpenFaiResult.error`, never a throw.
 */
export interface FaiViewerLibsOptions {
  /**
   * Master switch for dynamic loading of non-preset libraries. Default `true`.
   * `false` removes the loader entirely, so an import of an unregistered
   * library fails with an unbound-namespace execution error.
   */
  enabled?: boolean
  /**
   * CDN base for browser hosts (must end in `/`). Defaults to the jsDelivr npm
   * mirror (`https://cdn.jsdelivr.net/npm/`).
   */
  cdnBase?: string
  /**
   * Exact version pins: npm package name → version. Browser hosts build
   * `+esm` direct links from these. Pin to the host engine's version line —
   * `registerLib` rejects a library whose `contractVersion` does not match.
   */
  versions?: Record<string, string>
  /**
   * Whitelist of npm package names the loader may load. Omitted = unrestricted.
   * A `.fai.zip` is untrusted input, so production hosts should provide this.
   */
  allow?: string[]
  /** Aliases mapping script specifiers to npm package names (`gears` → `@faicad/faijs-gears`). */
  aliases?: Record<string, string>
  /**
   * Injectable dynamic-import implementation (tests, or hosts with a custom
   * loading channel). Defaults to the native dynamic `import()`.
   */
  importModule?: (url: string) => Promise<unknown>
}

/** Options for {@link openFaiZip}. Only `wasm` is required. */
export interface OpenFaiZipOptions {
  /** The three engine wasm URLs; each must be a non-empty string. */
  wasm: FaiZipViewerWasmOptions
  /** Execute this specific model id. Defaults to container `active`, else `models[0]`. */
  modelId?: string
  /** Execution mode. Default `'auto'` (static BREP/mesh dispatch). */
  mode?: 'auto' | 'brep' | 'mesh'
  /** Execution timeout in milliseconds. Omitted = engine default. */
  executionTimeoutMs?: number
  /**
   * Optional constraint-solver config for models that use `cad.sketch`.
   * Node auto-loads the solver; a browser host passes
   * `planegcsUrl` to self-host the `planegcs.wasm` binary.
   */
  sketch?: SketchSolverOptions
  /**
   * Optional dynamic-loading config for third-party faijs libraries (e.g.
   * `@faicad/faijs-gears`, `@faicad/sheetmetal`). Omitted = dynamic loading
   * enabled with unrestricted package set (see `FaiViewerLibsOptions`).
   */
  libs?: FaiViewerLibsOptions
}

/** One tessellated mesh returned by {@link openFaiView}. */
export interface FaiViewerMesh {
  /** Part/terminal name this mesh belongs to. */
  name: string
  /** Interleaved `x,y,z` triangle vertices. */
  positions: Float32Array
  /** Triangle indices (groups of three) into `positions`. */
  indices: Uint32Array
}

/** Structured failure of a viewer operation. */
export interface FaiViewerError {
  code: FaiZipViewerErrorCode
  message: string
  /** Underlying engine error, when the failure was thrown. */
  detail?: unknown
}

/**
 * Structured resolution code for a viewer failure. Reported through
 * {@link OpenFaiResult.error} rather than thrown, so hosts get an inspectable
 * result object.
 */
export type FaiZipViewerErrorCode =
  /** The wasm options were missing or one of the three urls was empty. */
  | 'E_WASM_URL'
  /** The `.fai.zip` bytes failed container validation / read caps. */
  | 'E_CONTAINER'
  /** The model graph failed to execute (see `detail`). */
  | 'E_EXECUTION'
  /** The model produced no visible mesh. */
  | 'E_NO_GEOMETRY'

/** Result of {@link openFaiView}. A failure is reported via `error`, not a throw (except wasm/environment errors, which throw). */
export interface OpenFaiResult {
  /** Source file name recorded in conversion provenance, when present. */
  sourceFile?: string
  /** The executed model id (after active model defaulting). */
  modelId: string
  /** The visible, structured mesh list. */
  meshes: FaiViewerMesh[]
  /** Set when reading or executing fails; see `FaiViewerError`. */
  error?: FaiViewerError
}