let part0 = cad.box({ size:30 })
part0 = cad.translate(part0, { offset:[0,0,14] })
let part1 = cad.text(part0, { text:'HELLO', size:8, depth:2 })
