let part0 = cad.box(20 * mm, 20 * mm, 20 * mm, { centered: true })
part0 = cad.rotate_euler(part0, { anglesDeg:[45,0,0] })
part0 = cad.rotate_euler(part0, { anglesDeg:[0,90,0], pivot:[0,0,10] })
