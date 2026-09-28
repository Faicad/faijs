let part0 = cad.box(20 * mm, 20 * mm, 20 * mm, { centered: true })
// GeomRef would be used with actual face references
// For testing, we just verify the syntax is accepted
part0 = cad.translate(part0, { offset:[10,0,0] })
