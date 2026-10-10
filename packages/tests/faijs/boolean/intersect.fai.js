let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
let part1 = cad.sphere({ radius:12 * MM, center:[0 * MM,0 * MM,0 * MM] })
let part2 = cad.intersect(part0, part1)
