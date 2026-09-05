let part0 = cad.box(20, 20, 20, { centered: true })
part0 = cad.translate(part0, { offset:[5,0,0] })
part0 = cad.rotate_euler(part0, { anglesDeg:[0,0,45] })
part0 = cad.scale(part0, 1.5)
