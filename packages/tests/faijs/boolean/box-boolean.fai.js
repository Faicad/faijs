let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
let part1 = cad.sphere({ radius: 8 * MM, center:[5 * MM,0 * MM,0 * MM] })
let part2 = cad.subtract(part0, part1)
