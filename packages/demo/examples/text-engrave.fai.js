let part0 = cad.box(30 * MM, 30 * MM, 30 * MM, { centered: true })
part0 = cad.translate(part0, { offset:[0 * MM, 0 * MM, 14 * MM] })
let part1 = cad.text(part0, { text:'HELLO', size:8, depth:2 })
