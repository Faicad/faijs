/**
 * §1.4/1.5 lineage wiring (integration) — proves the blood-line registrar is
 * actually invoked during dual-op execution (not silently skipped by the
 * nested-call guard), and that replay re-registration is idempotent (N3
 * `E_TOPO_DUPLICATE_STMT` does not misfire on identical content across
 * separate `runCode` executions).
 *
 * This is the closure test for G6 (no silent mis-naming): before §1.4/1.5 the
 * `runtimeLineage.register` call sites were zero (grep-confirmed), so N1/N2/N3
 * were dead at runtime. After wiring, every top-level dual-op execution must
 * leave a node in `runtimeLineage`, and a second execution of the same code
 * must not throw on the already-present stmt.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asStmtId } from '@faicad/faijs/identity'
import { runtimeLineage } from '@faicad/faijs/topology/naming/lineage'
import { createEditorRuntime } from '../_support/editor-runtime'

/**
 * GOTCHA: `StmtId` is `s{lineNo}`, NOT the statement ordinal (same rule the G3
 * suite documents at its `BOX_ORIGIN` constant). Both statements must therefore
 * live on their own lines — putting two on one line collapses them to the same
 * anchor (`s1`) and the second is skipped as an already-executed line.
 */
const CODE = [
  'const a = cad.box(10, 10, 10)',
  'const b = cad.fillet(a, { edges: [cad.edgeRef(a, 2)], radius: 2 })',
].join('\n')

describe('§1.4/1.5 lineage wiring (integration)', () => {
  beforeAll(async () => {
    await registerOcctBrepEngine()
  }, 120000)

  it('populates the blood-line graph for a hand-written chain', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      const res = await runtime.execute(CODE, { topology: 'auto' })
      expect(res.failedAt, `执行失败：${res.failedAt?.message}`).toBeUndefined()
      // `runtimeLineage` is cleared only at the next runCode start, so right
      // after this execute it still holds this execution's nodes.
      expect(runtimeLineage.size, 'lineage graph was not populated by execution').toBeGreaterThanOrEqual(2)
      const boxNode = runtimeLineage.node(asStmtId('s1'))
      expect(boxNode, 's1 (box) node missing').toBeDefined()
      expect(boxNode!.op).toMatch(/box/)
      const filletNode = runtimeLineage.node(asStmtId('s2'))
      expect(filletNode, 's2 (fillet) node missing').toBeDefined()
      expect(filletNode!.provenance.kind).toBe('kernel')
    } finally {
      runtime.dispose()
    }
  })

  it('replay re-registration is idempotent (N3 does not misfire)', async () => {
      const runtime = createEditorRuntime(createNodePorts(), 'brep')
    try {
      const r1 = await runtime.execute(CODE, { topology: 'auto' })
      expect(r1.failedAt, `第一次执行失败：${r1.failedAt?.message}`).toBeUndefined()
      // Second execution re-runs the same code → same stmts. The graph is
      // cleared at runCode start, then re-registered; identical content must
      // not trip N3 (E_TOPO_DUPLICATE_STMT).
      const r2 = await runtime.execute(CODE, { topology: 'auto' })
      expect(r2.failedAt, `重放触发 N3：${r2.failedAt?.message}`).toBeUndefined()
      expect(runtimeLineage.size, 'lineage graph not repopulated after replay').toBeGreaterThanOrEqual(2)
    } finally {
      runtime.dispose()
    }
  })
})
