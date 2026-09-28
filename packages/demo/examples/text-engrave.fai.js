let part0 = cad.box(30 * mm, 30 * mm, 30 * mm, { centered: true })
part0 = cad.translate(part0, { offset:[0,0,14] })
let part1 = cad.text(part0, { text:'HELLO', size:8, depth:2 })
