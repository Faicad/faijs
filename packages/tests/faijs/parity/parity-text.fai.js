let part0 = cad.box(50 * MM, 50 * MM, 50 * MM, { centered: true })
part0 = cad.translate(part0, { offset:[0 * MM,0 * MM,24 * MM] })
let part1 = cad.text(part0, { text:'TEST', size:10 * MM, depth:3 * MM })
