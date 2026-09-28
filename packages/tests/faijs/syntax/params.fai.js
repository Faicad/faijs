const size = 20
const radius = 10
let part0 = cad.box(size * mm, size * mm, size * mm, { centered: true })
let part1 = cad.sphere({ radius:radius, center:[30,0,0] })
let part2 = cad.union(part0, part1)
