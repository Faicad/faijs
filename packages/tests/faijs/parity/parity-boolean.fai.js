let part0 = cad.box(30 * MM, 30 * MM, 30 * MM, { centered: true })
let part1 = cad.sphere({ radius:10 * MM, center:[0 * MM,0 * MM,0 * MM] })
let part2 = cad.subtract(part0, part1)
