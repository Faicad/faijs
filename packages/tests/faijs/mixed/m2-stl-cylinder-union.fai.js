// M2: curved BREP triangulation — load(stl) + cylinder → union (mixed)
let part0 = cad.load({ key: 'cube-10x5x5' })
let part1 = cad.cylinder(8, 20, { centered: true })
let part2 = cad.union(part0, part1)
