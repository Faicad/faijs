let part0 = cad.box(30, 20, 15, { centered: true })
let part1 = cad.cylinder({ radius:5, height:20, center:[0,0,0] })
let part2 = cad.subtract(part0, part1)
part2 = cad.translate(part2, { offset:[10,0,0] })
