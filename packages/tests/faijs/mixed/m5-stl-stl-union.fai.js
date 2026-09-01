// M5: all-mesh control — load(stl) + load(stl) → union (must stay on mesh path, zero change)
let part0 = cad.load({ key: 'cube-10x5x5' })
let part1 = cad.load({ key: 'cube-10x5x5' })
let part2 = cad.union(part0, part1)
