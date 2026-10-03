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
 * Options for the `cad.sketch` / `cad.draw` constraint solver that real
 * FreeCAD-converted `.fai.zip` models require.
 *
 * The sketch op folds `@faicad/faijs-sketch` (and `cad.draw` from
 * `@faicad/faijs-draw`) into the `cad` namespace and needs the planegcs
 * constraint solver. In a Node runner the solver auto-loads its wasm from the
 * installed `@salusoft89/planegcs` package; a browser host must self-host the
 * `planegcs.wasm` binary and supply its URL here. When running in a browser
 * without `planegcsUrl`, sketch-based models fail with `E_SKETCHC_NO_SOLVER`
 * (reported through `OpenFaiResult.error`).
 */
export interface SketchSolverOptions {
  /** Browser-only: URL of the self-hosted `planegcs.wasm` constraint solver. */
  planegcsUrl?: string
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
   * Optional constraint-solver config for models that use `cad.sketch` /
   * `cad.draw`. Node auto-loads the solver; a browser host passes
   * `planegcsUrl` to self-host the `planegcs.wasm` binary.
   */
  sketch?: SketchSolverOptions
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