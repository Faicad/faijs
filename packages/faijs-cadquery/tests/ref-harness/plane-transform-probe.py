"""One-shot CadQuery 2.8.0 reference capture for Plane.toLocalCoords /
mirrorInPlane parity (faijs-cadquery P2). NOT run in CI — run once, harden the
values into src/plane.test.ts.

Captures, for each (plane, shape) pair, the post-transform bounding-box centre
and volume, plus the vector-form local coords of a reference point. This pins the
exact CadQuery semantics (toLocalCoords moves the shape INTO the plane's local
frame; mirrorInPlane reflects about the plane's X/Y axis).
"""
import cadquery as cq
import json
import math

ROOT = cq.Workplane().box(1, 1, 1)          # centred at origin, volume 1
OFF = cq.Workplane().box(1, 1, 1).translate((2, 3, 4))  # centre (2,3,4)


def centre_of(shape):
    bb = shape.BoundingBox()
    return [
        (bb.xmin + bb.xmax) / 2,
        (bb.ymin + bb.ymax) / 2,
        (bb.zmin + bb.zmax) / 2,
    ]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def make_plane(origin, xDir, normal):
    yDir = cross(normal, xDir)  # right-handed: xDir × yDir = normal
    plane = cq.Plane(origin=origin, xDir=xDir, normal=normal)
    params = {"origin": list(origin), "xDir": [round(v, 6) for v in xDir],
              "yDir": [round(v, 6) for v in yDir], "normal": [round(v, 6) for v in normal]}
    return plane, params


def first(obj):
    return obj[0] if isinstance(obj, (list, tuple)) else obj


def probe(label, plane, params, shape, mirror_axis=None):
    rec = {"label": label, "plane": params}
    local = first(plane.toLocalCoords(shape.val()))
    rec["toLocalCoords"] = {"centre": [round(v, 6) for v in centre_of(local)],
                            "volume": round(local.Volume(), 9)}
    if mirror_axis is not None:
        mir = first(plane.mirrorInPlane(shape.val(), mirror_axis))
        rec["mirrorInPlane_" + mirror_axis] = {
            "centre": [round(v, 6) for v in centre_of(mir)],
            "volume": round(mir.Volume(), 9),
        }
    return rec


def main():
    out = []
    # 1. default XY plane (identity)
    p_xy, p_xy_p = make_plane((0, 0, 0), (1, 0, 0), (0, 0, 1))
    out.append(probe("XY/ROOT", p_xy, p_xy_p, ROOT, 'X'))
    out.append(probe("XY/OFF", p_xy, p_xy_p, OFF, 'X'))
    # 2. translated plane (origin 2,3,4)
    p_tr, p_tr_p = make_plane((2, 3, 4), (1, 0, 0), (0, 0, 1))
    out.append(probe("TR/ROOT", p_tr, p_tr_p, ROOT, 'X'))
    out.append(probe("TR/OFF", p_tr, p_tr_p, OFF, 'X'))
    # 3. tilted (45 deg about Z) plane, still normal +Z
    c = math.cos(math.radians(45))
    s = math.sin(math.radians(45))
    p_tilt, p_tilt_p = make_plane((0, 0, 0), (c, s, 0), (0, 0, 1))
    out.append(probe("TILT/OFF", p_tilt, p_tilt_p, OFF, 'X'))
    # 4. arbitrary normal plane (normal +Y)
    p_y, p_y_p = make_plane((0, 0, 0), (1, 0, 0), (0, 1, 0))
    out.append(probe("Y/OFF", p_y, p_y_p, OFF, 'X'))
    # vector form (CadQuery toLocalCoords accepts a Vector; mirrorInPlaneVec is
    # verified self-consistently in the TS suite, not against CadQuery here)
    p_xy_v, p_xy_vp = make_plane((0, 0, 0), (1, 0, 0), (0, 0, 1))
    out.append({"label": "VEC/XY", "plane": p_xy_vp,
                "toLocalCoordsVec": [round(v, 6) for v in list(p_xy_v.toLocalCoords(cq.Vector(2, 3, 4)))]})
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
