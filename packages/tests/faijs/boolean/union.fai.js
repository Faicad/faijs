let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
let part1 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true, at: [10 * MM,0 * MM,0 * MM] })
let part2 = cad.union(part0, part1)
