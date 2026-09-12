"""Compute BARE (no features) CrossedHelicalGear volume via cadquery-env, to judge
whether our base crossed-helical geometry is correct (independent of hub/recess)."""
import json, sys
sys.path.insert(0, r'C:\git\CADQ\cq_gears')
import cadquery as cq
from cq_gears import CrossedHelicalGear

m = json.load(open('fixtures/reference/manifest.json'))
for cid in ['case29-CrossedHelicalGear', 'case30-CrossedHelicalGear']:
    c = next(x for x in m['cases'] if x['id'] == cid)
    a = c['args']
    g = CrossedHelicalGear(
        module=a['module'], teeth_number=a['teeth_number'], width=a['width'],
        helix_angle=a['helix_angle'], pressure_angle=a.get('pressure_angle', 20.0),
    )
    vol = g.build().Volume()
    print(f"{cid}: bare(no-feature) vol={vol:.6f}  (ref-with-features={c['volume']:.6f})")
