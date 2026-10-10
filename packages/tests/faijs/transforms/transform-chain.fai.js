let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
part0 = cad.translate(part0, { offset:[5 * MM,0 * MM,0 * MM] })
part0 = cad.rotate_euler(part0, { angles:[0 * DEGREE,0 * DEGREE,45 * DEGREE] })
part0 = cad.scale(part0, 1.5)
