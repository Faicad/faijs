import { readFileSync } from 'node:fs'

const checks = [
  ['./src/boolean/cross-section.ts', ['computeSection', 'buildExtrudedProfile']],
  ['./src/boolean/csg-core.ts', ['manifoldToMeshData']],
  ['./src/boolean/deriveNormals.ts', ['deriveNormals']],
  ['./src/boolean/extrude-helpers.ts', ['buildExtrudeParts', 'makeWorldPlane']],
  ['./src/boolean/joinery-shapes.ts', ['buildWedgeGeometry', 'buildDowelGeometry', 'buildStraightTenonGeometry', 'JoineryMeshData']],
  ['./src/cad-core/query.ts', ['faceAt']],
  ['./src/components/engraving/knurl/KnurlGenerator.ts', ['applyKnurlDisplacement', 'KNURL_DEFAULTS']],
  ['./src/components/engraving/knurl/subdivision.ts', ['subdivide']],
  ['./src/components/engraving/knurl/textureLoader.ts', ['loadKnurlingTexture', 'TextureData']],
  ['./src/primitives/geometry.ts', ['mergeBufferGeometries', 'makePrimitiveGeo', 'DEFAULT_SIZE', 'applyPrimitiveOffset']],
  ['./src/primitives/screw/screw.ts', ['makeScrew']],
  ['./src/primitives/screw/screw-db.ts', ['getScrewSpec', 'getScrewSpecs', 'threadToPitchMm', 'ScrewParams']],
  ['./src/primitives/svg-extrude.ts', ['svgToExtrudedGeometry']],
  ['./src/primitives/text/cjk.ts', ['loadSystemCjkFont', 'containsCjk', 'createMixedTextGeometry']],
  ['./src/primitives/types.ts', ['PrimitiveType', 'PrimitiveParamsRecord', 'PrimitiveArgsRecord', 'PrimitiveMeta', 'nextPrimitiveColor']],
  ['./src/sdf/sdf-runner.ts', ['runSdf', 'cancelAllSdfRequests', 'SdfMeshData']],
  ['./src/sdf/templates.ts', ['SDF_TEMPLATES', 'DEFAULT_SDF_TEMPLATE']],
  ['./src/sdf/types.ts', ['SdfMeta', 'SdfBox', 'SdfParamDef', 'SdfTemplateCategory', 'boxToTuple', 'parseParamDefs', 'defaultParamValues']],
  ['./src/occt/meshReconstruct.ts', ['reconstructSolidFromMesh', 'meshToAsciiStl', 'cadShapeIsValid']],
  ['./src/occt/occtKernel.ts', ['ShapeHandle']],
  ['./src/topology/build-face-ids.ts', ['TOPOLOGY_FACE_ID_NONE', 'buildFaceIdsForPart']],
  ['./src/topology/build-selector-runtime.ts', ['buildSelectorRuntime', 'buildSelectorRuntimeData', 'buildSelectorRuntimeMaps', 'SelectorRuntimeData']],
  ['./src/topology/types.ts', ['SelectorRuntime', 'SelectorBundle', 'SelectorManifest', 'SelectorBuffers', 'FaceRow', 'EdgeRow', 'Reference']],
]

for (const [file, syms] of checks) {
  const content = readFileSync(file, 'utf8')
  const missing = syms.filter(s => {
    // Check for export declarations
    const patterns = [
      `export ${s}`,
      `export type ${s}`,
      `export interface ${s}`,
      `export const ${s}`,
      `export function ${s}`,
      `export class ${s}`,
      `export enum ${s}`,
      `export { ${s}`,
      `export {${s}`,
    ]
    return !patterns.some(p => content.includes(p))
  })
  if (missing.length) {
    console.log(`${file}: MISSING: ${missing.join(', ')}`)
  } else {
    console.log(`${file}: OK`)
  }
}
