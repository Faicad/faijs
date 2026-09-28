let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
part0 = cad.rotate_euler(part0, { angles:[45,0,0] })
part0 = cad.rotate_euler(part0, { angles:[0,90,0], pivot:[0,0,10] })
