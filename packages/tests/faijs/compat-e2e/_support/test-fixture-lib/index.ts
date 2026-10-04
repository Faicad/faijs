/**
 * test-fixture-lib — third-party library fixture (B4/C1 aggregate entry).
 *
 * Simulates a third-party CAD library outside the repo:
 * - mock-mech-ing / mock-mech-mesh: B4 fixture (third-party lib BREP/mesh version)
 * - gear: C2 fixture (gear/thread factories, `import * as gear from 'test-fixture-lib'` target)
 *
 * P24 (§8.1) depends on `@faicad/faijs` (L4 depends on host package, L2/L1 do not).
 *
 * ⚠️ mock-mech-mesh's symbols collide with the BREP version (contractVersion /
 * makeHeadstock / makeBall), so `export *` would be ambiguous; mock-mech-mesh is
 * imported directly by file path (mock-lib.test.ts), not via the package entry.
 * gear symbols have no name collision and are fully re-exported.
 */
export * from './gear.js'
export * as mockBrep from './mock-mech-brep.js'
export { contractVersion, makeHeadstock, makeBall } from './mock-mech-brep.js'
export type { SolidShape } from '@faicad/faijs/sdk'
