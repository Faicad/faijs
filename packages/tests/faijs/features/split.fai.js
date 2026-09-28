let part0 = cad.box(30 * mm, 30 * mm, 30 * mm, { centered: true })
const { front: part1, back: part2 } = cad.fai_split(part0)
