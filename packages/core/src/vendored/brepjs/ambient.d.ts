/**
 * Ambient global declarations for the vendored brepjs tree (P1/P2/P3 port).
 *
 * brepjs references `WebAssembly.Exception` (occt-wasm error unwrapping,
 * `kernel/occtWasm/adapterShims.ts`) and narrows on
 * `instanceof WebAssembly.RuntimeError` (`topology/meshFns.ts`). The isolated
 * D9 tsconfig uses `lib: ["ES2022"]` without DOM/webworker libs, so the global
 * is absent from the type domain — declare a minimal structural shape so the
 * `instanceof` narrows while keeping the untyped `Exception` escape hatch.
 *
 * Only ever instantiated inside a WASM-capable JS environment (browser or
 * Node ≥20), where the global exists at runtime.
 */
declare const WebAssembly: {
  /** Structurally typed so `e instanceof WebAssembly.RuntimeError` narrows. */
  readonly RuntimeError: new (message?: string) => Error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape unknown in ES lib
  readonly Exception: any;
};

/**
 * Browser-only globals referenced by `topology/surfaceFns.ts`
 * (`surfaceFromImage`, guarded by `typeof createImageBitmap !== 'function'` at
 * runtime) and `topology/meshFns.ts`. Declared structurally so the isolated
 * `lib: ["ES2022"]` build compiles; every call site guards availability first.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal structural stubs
declare const createImageBitmap: ((blob: Blob) => Promise<ImageBitmap>) | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal structural stub
declare const OffscreenCanvas: any;

/** Minimal structural shape for `ImageBitmap` used by surfaceFromImage. */
declare interface ImageBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}
declare const ImageBitmap: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural value
  new (blob: Blob): ImageBitmap;
};