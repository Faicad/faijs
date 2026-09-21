import { generateModel } from '../src/fcstd/codegen.js';

const mk = (type: string, name: string, props: Record<string, Record<string, string>> = {}) => {
  const properties = new Map(Object.entries(props).map(([k, attrs]) => [k, {
    name: k, type: '', tagName: 'Property',
    children: [{ name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: attrs }],
    valueXml: '', valueText: '', attributes: {},
  } as never]));
  return { type, name, properties };
};
const body = mk('PartDesign::Body', 'Body');
body.properties.set('Group', {
  name: 'Group', type: 'App::PropertyLinkList', tagName: 'Property',
  children: [{ name: 'LinkList', type: '', tagName: 'LinkList',
    children: [{ name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: 'Pad' } }],
    valueXml: '', valueText: '', attributes: { count: '1' } }],
  valueXml: '', valueText: '', attributes: {},
} as never);
const doc = { objects: [
  body,
  mk('Sketcher::SketchObject', 'Sketch'),
  mk('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
  mk('Part::Box', 'Box'),
  mk('Part::Cut', 'Cut', { Base: { value: 'Box' }, Tool: { value: 'Body' } }),
], typeIndex: new Map(), meta: new Map() } as never;
const contours = new Map([['Sketch', [{ closed: true, segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }] }]]]) as never;
const verdicts = new Map([['Sketch', { level: 'L0' as const, loopCount: 1 }]]) as never;
const r = generateModel(doc, verdicts, contours, 't');
console.log('calls:', r.calls.map((c) => `${c.op} src=${c.source} in=${c.inputs.join('|')}`).join('\n  '));
console.log('results:', (r as unknown as { objects: { name: string; disposition: string; reason?: string }[] }).objects
  .map((x) => `${x.name}:${x.disposition}${x.reason ? '(' + x.reason + ')' : ''}`).join(', '));
