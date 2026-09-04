// Aluminum sheet-metal enclosure — 120x80 base, four 40-high walls, corner
// seams closing the loop, 1.5 mm aluminum. Registered lib binding: 'sheet-lib'
// (callers must registerLib('sheet', ns, { compat: true }) with the import
// binding name matching the registration key).
import * as sheet from 'sheet-lib'

let p0 = sheet.author({ thickness: 1.5, base: { length: 120, width: 80 }, flanges: [
  { id: 'wx1', length: 40, angleDeg: 90, side: 'xmax', rule: { innerRadius: 1.5, kFactor: 0.44 } },
  { id: 'wx0', length: 40, angleDeg: 90, side: 'xmin', rule: { innerRadius: 1.5, kFactor: 0.44 } },
  { id: 'wy1', length: 40, angleDeg: 90, side: 'ymax', rule: { innerRadius: 1.5, kFactor: 0.44 } },
  { id: 'wy0', length: 40, angleDeg: 90, side: 'ymin', rule: { innerRadius: 1.5, kFactor: 0.44 } }
], seams: [
  { parent: 'wx1', child: 'wy1', angleDeg: 90, rule: { innerRadius: 1.5, kFactor: 0.44 } },
  { parent: 'wy1', child: 'wx0', angleDeg: 90, rule: { innerRadius: 1.5, kFactor: 0.44 } },
  { parent: 'wx0', child: 'wy0', angleDeg: 90, rule: { innerRadius: 1.5, kFactor: 0.44 } },
  { parent: 'wy0', child: 'wx1', angleDeg: 90, rule: { innerRadius: 1.5, kFactor: 0.44 } }
], material: { name: 'aluminum-16ga', thickness: 1.5, defaultRule: { innerRadius: 1.5, kFactor: 0.44 } } })

let p1 = sheet.autoReliefs(p0, { shape: 'obround', width: 2, depth: 2 })
let p2 = sheet.addCutout(p1, { kind: 'hole', region: 'root', x: 15, y: 15, diameter: 4 })
let p3 = sheet.addCutout(p2, { kind: 'slot', region: 'wy1', x: 30, y: 20, length: 40, width: 3, round: true })
let s1 = sheet.solidOf(p3)
let u1 = sheet.unfold(p3)
let r1 = sheet.report(p3)
