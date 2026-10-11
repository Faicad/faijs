/**
 * meshdata — core 自有的 mesh 容器与参数化几何（three `BufferGeometry` 与
 * `Box/Cylinder/Cone/SphereGeometry` 的替代）。
 *
 * 纯函数集作用于对外类型 `Shape`（不挂方法）；参数化几何逐位复刻 three r162
 * 的顶点/索引顺序以保 `faceRanges` 面序契约（MIT License, © 2010-2024 three.js
 * authors）。与既有 `mesh/query.ts`（boundingBox/volume 等查询）职责不重叠。
 */

export { weldMesh, type MeshData } from './weld'
export {
  boxGeometry,
  cylinderGeometry,
  coneGeometry,
  sphereGeometry,
  type GeoData,
} from './parametric'
export {
  shapeFromMesh,
  toNonIndexed,
  transformShape,
  translateShape,
  computeVertexNormals,
  mergeShapes,
  type MatrixLike,
} from './ops'