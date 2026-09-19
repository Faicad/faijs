// probe: minimal repro of e2e failure — circle sketch extrude upTo plane (brep)
import { initOcctWasm } from '../src/occt-kernel/occtKernel.ts';
import { createApiNamespace } from '../src/api/api-namespace.ts';
import { writeFileSync, rmSync } from 'node:fs';

await initOcctWasm();
const cad = createApiNamespace();
const circle = { contours: [{ segments: [{ kind: 'arc', cx: -33.057236, cy: 30.001772, radius: 7.728417011119, startAngle: 0, endAngle: 6.283185307179586, ccw: true, x1: -25.328818988881004, y1: 30.001772, x2: -25.328818988881004, y2: 30.001772 }], closed: true }] };
const sk = cad.sketch(circle);
console.log('sketch ok');
const up = { upTo: { plane: { point: [-50, 100, -49.99999999999997], normal: [-0.7053456158587508, 0.07053456158639328, 0.7053456158583923] } } };
try {
  const ex = cad.extrude(sk, up);
  console.log('extrude ok', ex !== undefined);
} catch (e) {
  console.log('extrude FAILED:', (e as Error).message.slice(0, 200));
}
// control: same sketch, plain length extrude
try {
  const ex2 = cad.extrude(sk, { length: 50 });
  console.log('plain extrude ok');
} catch (e) {
  console.log('plain extrude FAILED:', (e as Error).message.slice(0, 200));
}
