let part0 = cad.box({ size:20 })
part0 = cad.translate(part0, { offset:[5,0,0] })
part0 = cad.rotate_euler(part0, { anglesDeg:[0,0,45] })
part0 = cad.scale3d(part0, { factor:1.5 })
