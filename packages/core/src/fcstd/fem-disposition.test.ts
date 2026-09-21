/**
 * H7 companion (2026-09-20): FEM workbench objects are simulation semantics,
 * not modeling geometry. They must land in a structured non-modeling
 * disposition (preserved-only) instead of `type-not-whitelisted` gaps that
 * block the whole file — the modeling part of e.g. box_static.FCStd is just
 * a Part::Box + material.
 *
 * Corpus facts (probe, 2026-09-20):
 * - Python subclasses (FemAnalysisPython / FemMeshObjectPython /
 *   FemSolverObjectPython / FemMeshShapeBaseObjectPython / FemResultObjectPython
 *   / Fem::FeaturePython) carry Proxy → already handled by H10 (python-opaque).
 * - Native classes WITHOUT Proxy still gap: Fem::FemMeshObject,
 *   Fem::ConstraintFixed/Force/Pressure/Contact/Bearing/Displacement,
 *   Fem::FemResultObject, Fem::FemPostPipeline(+filters via Python? filters are
 *   Python subclasses).
 * - FemMesh/result field data (FemMesh / Data properties) is large derived
 *   data: NOT copied into the container (regenerable from the shape).
 *
 * Remote task on record (user, 2026-09-20): faijs will eventually port
 * FreeCAD's FEM analysis capability — that is a separate future feature; this
 * change only stops FEM objects from blocking conversion.
 */
import { describe, it, expect } from 'vitest';
import { isFemStructural, FEM_STRUCTURAL_TYPES, STRUCTURAL_TYPES_EXTENDED } from './convert.js';

describe('H7-FEM: simulation objects are structured non-modeling, not gaps', () => {
  it('GOTCHA: native FEM classes WITHOUT Proxy are the gap source — all must be recognized', () => {
    for (const t of [
      'Fem::FemMeshObject',
      'Fem::FemResultObject',
      'Fem::ConstraintFixed',
      'Fem::ConstraintForce',
      'Fem::ConstraintPressure',
      'Fem::ConstraintContact',
      'Fem::ConstraintBearing',
      'Fem::ConstraintDisplacement',
      'Fem::FemPostPipeline',
    ]) {
      expect(isFemStructural(t), t).toBe(true);
      expect(FEM_STRUCTURAL_TYPES.has(t), t).toBe(true);
    }
  });

  it('does not over-match: non-FEM types stay unrecognized', () => {
    expect(isFemStructural('Part::Box')).toBe(false);
    expect(isFemStructural('PartDesign::Pad')).toBe(false);
    expect(isFemStructural('Fem::FemAnalysis')).toBe(true); // container too
    // Python subclasses carry Proxy → H10 python-opaque takes them; the set
    // may also list them, but they must never fall into type-not-whitelisted
    expect(isFemStructural('Fem::FemMeshObjectPython')).toBe(true);
  });

  it('2026-09-20 sweep triage: remaining FEM constraint/result families are structural too', () => {
    // surfaced after earlier blockers fell (all_objects corpus file)
    for (const t of [
      'Fem::ConstraintFluidBoundary',
      'Fem::ConstraintGear',
      'Fem::ConstraintHeatflux',
      'Fem::ConstraintInitialTemperature',
      'Fem::FemPostWarpVectorFilter',
    ]) {
      expect(isFemStructural(t), t).toBe(true);
    }
  });
});

describe('2026-09-20 triage: assembly/import container types are structured non-modeling', () => {
  it('GOTCHA: App::Link, Assembly containers, import placeholders → preserved-only, never gaps', () => {
    // AssemblyExample (Assembly::AssemblyObject + JointGroup + App::Link),
    // ProjectTest (App::InventorObject), TestVRMLTextures (App::VRMLObject).
    // Containers/links/import placeholders produce no geometry; they must
    // not block files whose modeling content converts fine.
    for (const t of [
      'App::Link',
      'App::LinkElement',
      'Assembly::AssemblyObject',
      'Assembly::JointGroup',
      'App::InventorObject',
      'App::VRMLObject',
    ]) {
      expect(STRUCTURAL_TYPES_EXTENDED.has(t), t).toBe(true);
    }
    // modeling features must NOT be captured
    expect(STRUCTURAL_TYPES_EXTENDED.has('Part::Mirroring')).toBe(false);
    expect(STRUCTURAL_TYPES_EXTENDED.has('PartDesign::AdditiveSphere')).toBe(false);
  });
});
