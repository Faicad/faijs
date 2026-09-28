let part0 = cad.box(30 * MM, 30 * MM, 30 * MM, { centered: true })
const { front: part1, back: part2 } = cad.fai_split(part0)
