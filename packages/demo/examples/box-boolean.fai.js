let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
let part1 = cad.sphere({ radius:8, center:[5,0,0] })
let part2 = cad.subtract(part0, part1)
