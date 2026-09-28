let part0 = cad.box(10 * mm, 10 * mm, 10 * mm, { centered: true })
part0 = cad.scale(part0, 2)
part0 = cad.scale3d(part0, { factor:[1,2,3] })
