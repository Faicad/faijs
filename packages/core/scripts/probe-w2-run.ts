// W2 type-2 runtime probe: run the FULL reconverted Body.fai.js (with the new
// Profile-link + face-attachment placements) and verify the fillet's Edge32
// reference resolves and the body builds. Usage:
//   npx tsx packages/core/scripts/probe-w2-run.ts [zip]
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createRuntime } from '../src/index.js';
import { createNodePorts } from '../src/node.js';
import { initOcctWasm } from '../src/occt-kernel/occtKernel.js';
import { getBrepApi } from '../src/brep/handle-bridge.js';
import { brepOf } from '../src/shape.js';

const ZIP = process.argv[2] ?? 'D:/Faicad/fcstd-port/.tmp-wallhung-reconv.fai.zip';

const members = unzipSync(new Uint8Array(readFileSync(ZIP)));
const full = strFromU8(members['model/Body.fai.js']!);

await initOcctWasm();
const scratch = join('D:/Faicad/faijs/.tmp-w2-run');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const runtime = createRuntime(createNodePorts({ assetsDir: scratch }), 'brep');
try {
  const result = await runtime.execute(full, { topology: 'auto' });
  if (result.failedAt) {
    console.log('EXEC FAILED:', result.failedAt.message);
  } else {
    console.log('EXEC OK');
  }
  const outputs = result.outputs as Map<string, unknown> | undefined;
  const kernel = getBrepApi()!;
  if (outputs && typeof outputs.get === 'function') {
    // report every output's topology, and specifically Pocket__place edge count
    for (const [name, s] of outputs) {
      const solid = brepOf(s as object);
      if (!solid) continue;
      const faces = kernel.getSubShapes(solid, 'face');
      const edges = kernel.getSubShapes(solid, 'edge');
      console.log(`  ${name}: faces=${faces.length} edges=${edges.length}`);
    }
    const pocket = outputs.get('Pocket__place');
    if (pocket) {
      const solid = brepOf(pocket as object)!;
      const edges = kernel.getSubShapes(solid, 'edge');
      console.log(`Pocket__place edges=${edges.length} (need >=32 for fillet Edge32)`);
    } else {
      console.log('Pocket__place not found in outputs');
    }
  } else {
    console.log('no outputs map');
  }
} finally {
  runtime.dispose();
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(0);
