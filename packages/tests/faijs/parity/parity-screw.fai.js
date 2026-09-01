// apiVersion: 1
// Tests BREP/mesh parity for screw (excluding thread details)
export default async (cad) => {
  let part0 = cad.screw({
    system: 'metric', specIdx: 5, thread: 'coarse',
    length: 30, head: 'hex',
  })
  return { shape: part0, name: 'parity-screw' }
}
