let part0 = cad.box(30 * MM, 20 * MM, 15 * MM, { centered: true })
let part1 = cad.cylinder(5 * MM, 20 * MM, { centered: true, at: [0, 0, 0] })
let part2 = cad.subtract(part0, part1)
part2 = cad.translate(part2, { offset:[10 * MM, 0 * MM, 0 * MM] })
