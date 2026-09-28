let part0 = cad.box(30 * mm, 30 * mm, 30 * mm, { centered: true })
let part1 = cad.sphere({ radius:10, center:[0,0,0] })
let part2 = cad.subtract(part0, part1)
