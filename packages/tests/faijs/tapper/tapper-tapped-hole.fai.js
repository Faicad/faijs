let part0 = cad.box(40 * MM, 40 * MM, 20 * MM, { centered: true })
let ref = cad.fai_drill(part0, { diameter: 2.5 * MM, depth: 0, position: [0 * MM, 0 * MM, 10 * MM], direction: 'z' })
let tapped = cad.fai_drill_tapper(part0, { drill: 'Ø2.5 完全贯穿', tap: 'M3-6H 完全贯穿', position: [0 * MM, 0 * MM, 10 * MM], direction: 'z' })
