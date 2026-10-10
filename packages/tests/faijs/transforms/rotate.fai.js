let part0 = cad.box(20 * MM, 20 * MM, 20 * MM, { centered: true })
part0 = cad.rotate_euler(part0, { angles:[45 * DEGREE,0 * DEGREE,0 * DEGREE] })
part0 = cad.rotate_euler(part0, { angles:[0 * DEGREE,90 * DEGREE,0 * DEGREE], pivot:[0 * MM,0 * MM,10 * MM] })
