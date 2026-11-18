/**
 * STEP PMI export tests.
 *
 * Verifies that:
 * 1. StepExportEntry accepts the pmi field.
 * 2. ExportEntry accepts the pmi field and passes it to StepExportEntry.
 * 3. stepApVersionForPmi returns 'AP242' when semantic PMI is present.
 * 4. stepApVersionForPmi returns undefined when no PMI or only notes.
 * 5. supportsXcafPmi returns false for regular XCAF documents (no DimTolTool).
 * 6. writePmiToXCAF returns 0 when unsupported (graceful degradation).
 * 7. PMI data survives JSON round-trip through StepExportEntry.
 */

import { describe, it, expect } from 'vitest'
import type { StepExportEntry } from '../../src/brep/export/step'
import type { ExportEntry } from '../../src/brep/export/export-model'
import type { PmiSet } from '../../src/api/pmi/types'
import { dimension, gdt, datum, localNote, threadHole, generalNote } from '../../src/api/pmi/types'
import { stepApVersionForPmi, supportsXcafPmi, writePmiToXCAF, upgradeStepSchemaForPmi } from '../../src/brep/export/step-pmi'
import type { FaceTopoRef } from '../../src/topology/naming/types'

const faceRef: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

const pmiWithSemantic: PmiSet = {
  items: [
    dimension({ dimType: 'diameter', targets: [faceRef], upperTolerance: 0.021 }),
    gdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 }),
    datum({ identifier: 'A', datumType: 'datumPlane', target: faceRef }),
  ],
}

const pmiNotesOnly: PmiSet = {
  items: [generalNote({ items: [{ text: 'some note' }] })],
}

describe('StepExportEntry pmi field', () => {
  it('accepts pmi field', () => {
    const entry: StepExportEntry = {
      name: 'part0',
      pmi: pmiWithSemantic,
    }
    expect(entry.pmi).toBeDefined()
    expect(entry.pmi!.items).toHaveLength(3)
  })

  it('pmi field is optional', () => {
    const entry: StepExportEntry = { name: 'part0' }
    expect(entry.pmi).toBeUndefined()
  })
})

describe('ExportEntry pmi field', () => {
  it('accepts pmi field', () => {
    const entry: ExportEntry = {
      name: 'part0',
      pmi: pmiWithSemantic,
    }
    expect(entry.pmi).toBeDefined()
    expect(entry.pmi!.items).toHaveLength(3)
  })
})

describe('stepApVersionForPmi', () => {
  it('returns AP242 for dimension', () => {
    const pmi: PmiSet = {
      items: [dimension({ dimType: 'linear', targets: [faceRef] })],
    }
    expect(stepApVersionForPmi(pmi)).toBe('AP242')
  })

  it('returns AP242 for gdt', () => {
    const pmi: PmiSet = {
      items: [gdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 })],
    }
    expect(stepApVersionForPmi(pmi)).toBe('AP242')
  })

  it('returns AP242 for datum', () => {
    const pmi: PmiSet = {
      items: [datum({ identifier: 'A', datumType: 'datumPlane', target: faceRef })],
    }
    expect(stepApVersionForPmi(pmi)).toBe('AP242')
  })

  it('returns undefined for notes-only PMI', () => {
    expect(stepApVersionForPmi(pmiNotesOnly)).toBeUndefined()
  })

  it('returns undefined for empty PMI', () => {
    expect(stepApVersionForPmi({ items: [] })).toBeUndefined()
  })

  it('returns undefined for undefined PMI', () => {
    expect(stepApVersionForPmi(undefined)).toBeUndefined()
  })
})

describe('supportsXcafPmi', () => {
  it('returns false for plain object (no DimTolTool)', () => {
    expect(supportsXcafPmi({})).toBe(false)
  })

  it('returns false for mock XCAF document', () => {
    const mockDoc = {
      addShape: () => 0,
      exportSTEP: () => '',
      close: () => {},
    }
    expect(supportsXcafPmi(mockDoc)).toBe(false)
  })

  it('returns true when setDimension exists', () => {
    const mockDoc = { setDimension: () => {} }
    expect(supportsXcafPmi(mockDoc)).toBe(true)
  })

  it('returns false for null/undefined', () => {
    expect(supportsXcafPmi(null)).toBe(false)
    expect(supportsXcafPmi(undefined)).toBe(false)
  })
})

describe('writePmiToXCAF graceful degradation', () => {
  it('returns 0 when doc does not support PMI', () => {
    const mockDoc = { addShape: () => 0, exportSTEP: () => '' }
    const faceLabelMap = new Map<string, number>()
    const written = writePmiToXCAF(mockDoc, pmiWithSemantic, faceLabelMap)
    expect(written).toBe(0)
  })

  it('returns 0 for empty PmiSet', () => {
    const mockDoc = { setDimension: () => {} }
    const faceLabelMap = new Map<string, number>()
    const written = writePmiToXCAF(mockDoc, { items: [] }, faceLabelMap)
    expect(written).toBe(0)
  })

  it('returns 0 for undefined PmiSet', () => {
    const mockDoc = { setDimension: () => {} }
    const faceLabelMap = new Map<string, number>()
    const written = writePmiToXCAF(mockDoc, undefined as unknown as PmiSet, faceLabelMap)
    expect(written).toBe(0)
  })

  it('skips threadHole / generalNote / localNote without writing or throwing', () => {
    // STEP AP242 has no entity for these kinds in occt-wasm. They must be
    // explicit switch branches (not a silent fallthrough) and must not
    // inflate the `written` counter.
    let dimensionCalls = 0
    const mockDoc = { setDimension: () => { dimensionCalls++ } }
    const pmi: PmiSet = {
      items: [
        localNote({ text: 'some note', anchor: [0, 0, 0] }),
        generalNote({ title: '技术要求', items: [{ index: 1, text: '锐边倒钝' }] }),
        threadHole({
          thread: {
            standard: 'metric',
            nominalDiameter: 6,
            pitch: 1,
            toleranceClass: '6H',
            depth: 14,
            specLabel: 'M6',
          },
          pilot: { diameter: 5, depth: 16 },
          axis: { origin: [0, 0, 10], direction: [0, 0, -1] },
          process: 'tapped',
        }),
      ],
    }
    expect(writePmiToXCAF(mockDoc, pmi, new Map<string, number>())).toBe(0)
    expect(dimensionCalls).toBe(0)
    expect(stepApVersionForPmi(pmi)).toBeUndefined()
  })
})

describe('PMI data survives JSON round-trip through StepExportEntry', () => {
  it('pmi items are preserved in JSON serialization', () => {
    const entry: StepExportEntry = {
      name: 'part0',
      pmi: pmiWithSemantic,
    }
    // Serialize only the pmi field (StepExportEntry has non-JSON fields like solid)
    const json = JSON.stringify(entry.pmi)
    const parsed: PmiSet = JSON.parse(json)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.items[0].kind).toBe('dimension')
    expect(parsed.items[1].kind).toBe('gdt')
    expect(parsed.items[2].kind).toBe('datum')
  })
})

describe('upgradeStepSchemaForPmi', () => {
  const sampleStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');
FILE_NAME('output.step','2026-10-31T12:00:00',(''),(''),'OCCT','','');
FILE_SCHEMA(('AP203_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 214 }'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`

  it('upgrades FILE_SCHEMA to AP242 when semantic PMI is present', () => {
    const result = upgradeStepSchemaForPmi(sampleStep, pmiWithSemantic)
    expect(result).toContain('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF')
    expect(result).not.toContain('AP203_')
  })

  it('does not modify text when no PMI', () => {
    const result = upgradeStepSchemaForPmi(sampleStep, undefined)
    expect(result).toBe(sampleStep)
  })

  it('does not modify text when notes-only PMI', () => {
    const result = upgradeStepSchemaForPmi(sampleStep, pmiNotesOnly)
    expect(result).toBe(sampleStep)
  })

  it('preserves DATA section geometry', () => {
    const result = upgradeStepSchemaForPmi(sampleStep, pmiWithSemantic)
    expect(result).toContain('DATA;')
    expect(result).toContain('ENDSEC;')
    expect(result).toContain('END-ISO-10303-21;')
  })
})
