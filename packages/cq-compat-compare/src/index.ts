/**
 * @faicad/cq-compat-compare — STEP / assembly geometry equivalence comparers
 * (dev-only tooling), split from @faicad/cq-compat.
 *
 * This package is NOT part of any runtime dependency chain: it is consumed only
 * by test harnesses, parity scripts and verification tooling. The CadQuery
 * compatibility surface lives in @faicad/cq-compat (workplane / 2D drawing /
 * features / selectors) and @faicad/cq-compat-assembly (assembly solve API).
 */

export { compareStepFiles, printCompareReport } from './step-compare'
export type {
  CompareOptions,
  StepCompareResult,
  MetricResult,
  TopologyStats,
} from './step-compare'

export { compareAssemblyFiles, printAssemblyReport } from './assembly-compare'
export type {
  AssemblyCompareOptions,
  AssemblyCompareResult,
  PartCompareResult,
} from './assembly-compare'
