let part0 = cad.box(50 * MM, 50 * MM, 50 * MM, { centered: true })
// SVG engrave would be tested with actual SVG data
// For now, test text engrave as a proxy
part0 = cad.engrave(part0, { text:'TEST', depth:2, textSize:8 })
