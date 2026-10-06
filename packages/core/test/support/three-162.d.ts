/**
 * three-162 — module shim for the aliased second three copy.
 *
 * `three-162` is `npm i -D three-162@npm:three@0.162.0`: the weapp host's pinned
 * line. It ships no types of its own, and the installed `@types/three` describes
 * the `three` package only, so this shim tells TypeScript the alias has the same
 * surface. Lives under `test-support/`, which `tsconfig.build.json` excludes.
 */
declare module 'three-162' {
  export * from 'three'
}
