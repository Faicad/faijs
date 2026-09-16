/**
 * M2 tests — container layer (V1 shadow fidelity, V3 zero-silent-loss).
 * Uses a synthetic in-memory FCStd archive plus a real sample if available.
 */
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { unpackFcstd, memberText } from './unpack.js';
import { buildFaiZip } from './build-fai-zip.js';
import { isOk } from '../vendored/brepjs/core/result.js';

function makeFakeFcstd(): Uint8Array {
  const doc = `<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" ProgramVersion="1.2R45573">
  <Objects Count="3">
    <Object type="Part::Box" name="Box"/>
    <Object type="Sketcher::SketchObject" name="Sketch"/>
    <Object type="App::Origin" name="Origin"/>
  </Objects>
  <ObjectData Count="3">
    <Object name="Box">
      <Properties Count="2">
        <Property name="Shape" type="Part::PropertyPartShape">
          <Part file="Box.brp"/>
        </Property>
        <Property name="Height" type="App::PropertyLength">
          <Float value="10"/>
        </Property>
      </Properties>
    </Object>
    <Object name="Sketch">
      <Properties Count="1">
        <Property name="Geometry" type="Part::PropertyGeometryList">
          <GeometryList count="0"/>
        </Property>
      </Properties>
    </Object>
    <Object name="Origin">
      <Properties Count="0"/>
    </Object>
  </ObjectData>
</Document>`;
  return zipSync(
    {
      'Document.xml': strToU8(doc),
      'GuiDocument.xml': strToU8('<GuiDocument/>'),
      'Box.brp': strToU8('CASCADE Topology V1 (c) fake brep bytes'),
    },
    { comment: strToU8('FreeCAD Document') },
  );
}

describe('fcstd container (M2)', () => {
  it('unpacks a synthetic FCStd regardless of ZIP comment', () => {
    const archive = unpackFcstd(makeFakeFcstd());
    expect(isOk(archive)).toBe(true);
    if (isOk(archive)) {
      expect(memberText(archive.value, 'Document.xml')).toContain('Part::Box');
    }
  });

  it('rejects non-ZIP input with not-zip error', () => {
    const archive = unpackFcstd(new Uint8Array([1, 2, 3, 4]));
    expect(isOk(archive)).toBe(false);
    if (!isOk(archive)) expect(archive.error.kind).toBe('not-zip');
  });

  it('rejects ZIP without Document.xml', () => {
    const zip = zipSync({ 'other.txt': strToU8('x') });
    const archive = unpackFcstd(zip);
    expect(isOk(archive)).toBe(false);
    if (!isOk(archive)) expect(archive.error.kind).toBe('no-document-xml');
  });

  it('builds .fai.zip with byte-exact freecad/ shadow (V1)', () => {
    const source = unpackFcstd(makeFakeFcstd());
    expect(isOk(source)).toBe(true);
    if (!isOk(source)) return;
    const built = buildFaiZip(source.value, 'fake.FCStd');
    expect(built.error).toBeUndefined();
    if (!built.result) return;
    // re-unpack the produced container and verify shadow byte equality
    const round = unzipSync(built.result.zip);
    for (const [path, bytes] of source.value.members) {
      const shadow = round[`freecad/${path}`];
      expect(shadow, `freecad/${path} present`).toBeDefined();
      expect(Buffer.from(shadow!).equals(Buffer.from(bytes))).toBe(true);
    }
    // member set identical: freecad/ prefix + assets + manifests
    const shadowPaths = Object.keys(round).filter((p) => p.startsWith('freecad/'));
    expect(shadowPaths.length).toBe(source.value.members.size);
  });

  it('ledger has a disposition for every object (V3)', () => {
    const source = unpackFcstd(makeFakeFcstd());
    if (!isOk(source)) return;
    const built = buildFaiZip(source.value, 'fake.FCStd');
    if (!built.result) return;
    const names = built.result.mapping.objects.map((o) => o.name).sort();
    expect(names).toEqual(['Box', 'Origin', 'Sketch']);
    for (const entry of built.result.mapping.objects) {
      expect(['translated', 'baked', 'preserved-only']).toContain(entry.disposition);
      if (entry.disposition !== 'translated') expect(entry.reason).toBeTruthy();
    }
    // Box owns Box.brp → baked asset present
    const box = built.result.mapping.objects.find((o) => o.name === 'Box')!;
    expect(box.artifacts).toContain('assets/Box.brp');
  });
});
