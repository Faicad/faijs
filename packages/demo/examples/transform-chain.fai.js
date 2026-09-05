let part0 = cad.box(20, 10, 5, { centered: true })
part0 = cad.rotate_euler(part0, { angles:[0,0,30] })
part0 = cad.translate(part0, { offset:[5,0,0] })
part0 = cad.scale3d(part0, { factor:[1,1,2] })
