let part0 = cad.box(50 * mm, 50 * mm, 50 * mm, { centered: true })
part0 = cad.translate(part0, { offset:[0,0,24] })
let part1 = cad.text(part0, { text:'TEST', size:10, depth:3 })
