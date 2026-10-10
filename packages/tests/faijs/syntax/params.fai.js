const size = 20
const radius = 10
let part0 = cad.box(size * MM, size * MM, size * MM, { centered: true })
let part1 = cad.sphere({ radius:radius, center:[30 * MM,0 * MM,0 * MM] })
let part2 = cad.union(part0, part1)
