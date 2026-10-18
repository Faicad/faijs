// M5: all-imported control — load(stl) + load(stl) → union (STL imports to BREP since v0.35.6, so → brep)
let part0 = cad.load({ file: 'cube-10x5x5.stl' })
let part1 = cad.load({ file: 'cube-10x5x5.stl' })
let part2 = cad.union(part0, part1)
