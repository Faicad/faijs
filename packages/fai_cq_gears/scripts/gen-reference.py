#! /usr/bin/env python3
"""
gen-reference.py — 生成 cq_gears（CadQuery / OCP）侧的参考数据，供 fai_cq_gears
的一致性测试使用。

产出（默认写到 <pkg>/fixtures/reference/）：
  * manifest.json         —— 每个用例的 volume / bbox / 齿廓点集 / 齿面点阵 / 齿面面积
                             / 齿面上的采样点（3D），以及生成环境版本
  * <case-id>.step        —— CadQuery 导出的 STEP（等价性比对的 A 侧）

设计要点：
  * 用例集分两档：`--set spike`（P0 可行性尖峰用，小而快）与
    `--set regression`（cq_gears 自带 31 例，T1/T2 全量用）。
  * 齿面采样点在 (u,v) 参数域上均匀取，故 **A/B 两侧曲面参数化不同也能比**——
    TS 侧用「点到面的最近距离」而不是 (u,v) 逐点比。
  * 齿廓/齿面点阵直接取自 gear 对象的内部数组（`t_lflank_pts` 等），
    与 `SpurGear._build_tooth_faces()` 喂给 `Face.makeSplineApprox` 的输入逐字节一致。

用法：
    python scripts/gen-reference.py [--set spike|regression] [--out DIR] [--ids id1,id2]
环境变量：
    FAI_CQ_PYTHON   解释器路径（由 gen-reference.ps1 设置）
    FAI_CQ_GEARS_SRC cq_gears 源码目录（默认 C:\\git\\CADQ\\cq_gears）
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
DEFAULT_OUT = PKG_ROOT / "fixtures" / "reference"
DEFAULT_CQ_GEARS_SRC = Path(r"C:\git\CADQ\cq_gears")
DEFAULT_CQ_REGRESSION_CASES = (
    Path(r"C:\git\CADQ\cq_gears") / "tests" / "regression" / "regression_test_cases.json"
)

# ── P0 可行性尖峰用例集：只有齿面构造，没有 bore/hub/spokes/chamfer ────────────
SPIKE_CASES = [
    {
        "id": "spur-basic",
        "class": "SpurGear",
        "args": {"module": 1.0, "teeth_number": 17, "width": 5.0},
    },
    {
        "id": "spur-helix15",
        "class": "SpurGear",
        "args": {"module": 1.0, "teeth_number": 17, "width": 5.0, "helix_angle": 15.0},
    },
    # 全链路工具链的对照组：与齿轮实现无关，只证明 ref→our→compare 管道可用
    {
        "id": "control-box",
        "class": "Box",
        "args": {"width": 10.0, "depth": 20.0, "height": 30.0},
    },
]

# 样条面采样密度（u 方向 × v 方向）
SAMPLE_NU = 7
SAMPLE_NV = 7


def bootstrap_sys_path() -> str:
    """把 cq_gears 源码目录放到 sys.path 首位，确保用的是源码而非 site-packages 副本。"""
    src = os.environ.get("FAI_CQ_GEARS_SRC") or str(DEFAULT_CQ_GEARS_SRC)
    p = Path(src)
    if (p / "cq_gears" / "__init__.py").exists():
        sys.path.insert(0, str(p))
        return str(p)
    return ""


def git_sha_of(path: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def sample_face_points(face, nu: int = SAMPLE_NU, nv: int = SAMPLE_NV):
    """在面的 (u,v) 参数域上均匀采样，返回世界坐标点列表。

    参数化无关性：A/B 两侧曲面的 (u,v) 定义不同，因此只导出 3D 点，
    由 TS 侧用「点到面最近距离」度量偏差。
    """
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.gp import gp_Pnt

    ad = BRepAdaptor_Surface(face.wrapped)
    u0, u1 = ad.FirstUParameter(), ad.LastUParameter()
    v0, v1 = ad.FirstVParameter(), ad.LastVParameter()
    pts = []
    for i in range(nu):
        for j in range(nv):
            u = u0 + (u1 - u0) * (i / (nu - 1))
            v = v0 + (v1 - v0) * (j / (nv - 1))
            p = gp_Pnt()
            ad.D0(u, v, p)
            pts.append([p.X(), p.Y(), p.Z()])
    return pts


def tooth_face_grids(gear, np):
    """复现 SpurGear._build_tooth_faces() 的点阵构造，导出输入点阵 + 输出面信息。

    返回的每项与 cq 喂给 `Face.makeSplineApprox` 的 `face_pts` 逐点一致。
    """
    from cq_gears.utils import rotation_matrix

    surf_splines = int(np.ceil(abs(gear.twist_angle) / np.pi))
    surf_splines = max(1, surf_splines) * gear.surface_splines
    spline_tf = np.linspace(
        (0.0, 0.0), (gear.twist_angle, gear.width), surf_splines
    )

    groups = [
        ("lflank", gear.t_lflank_pts),
        ("tip", gear.t_tip_pts),
        ("rflank", gear.t_rflank_pts),
        ("root", gear.t_root_pts),
    ]

    import cadquery as cq

    out = []
    for name, spline in groups:
        face_pts = []
        for a, z in spline_tf:
            r_mat = rotation_matrix((0.0, 0.0, 1.0), a)
            pts = spline.copy()
            pts[:, 2] = z
            pts = pts @ r_mat
            face_pts.append([[float(x), float(y), float(zz)] for (x, y, zz) in pts])

        face = cq.Face.makeSplineApprox(
            [[cq.Vector(*pt) for pt in row] for row in face_pts],
            tol=gear.spline_approx_tol,
            minDeg=gear.spline_approx_min_deg,
            maxDeg=gear.spline_approx_max_deg,
        )

        rows = len(face_pts)
        cols = len(face_pts[0])
        out.append(
            {
                "name": name,
                "rows": rows,
                "cols": cols,
                # 行主序展开（S1 `bsplineSurface(flat, rows, cols)` 直接吃这个形状）
                "points": [pt for row in face_pts for pt in row],
                "area": float(face.Area()),
                "sample_points": sample_face_points(face),
            }
        )
    return out


def build_case(entry, out_dir: Path):
    """构建一个用例，返回 manifest 条目并把 STEP 写到 out_dir。"""
    import cadquery as cq
    import cq_gears
    import numpy as np

    cls_name = entry["class"]
    args = dict(entry["args"])

    if cls_name == "Box":
        body = cq.Workplane("XY").box(
            args["width"], args["depth"], args["height"]
        ).val()
        item = {
            "id": entry["id"],
            "class": "Box",
            "args": args,
            "volume": float(body.Volume()),
            "bbox": [
                float(body.BoundingBox().xlen),
                float(body.BoundingBox().ylen),
                float(body.BoundingBox().zlen),
            ],
        }
        cq.exporters.export(body, str(out_dir / f"{entry['id']}.step"))
        return item

    cls = getattr(cq_gears, cls_name)
    gear = cls(**args)
    body = gear.build()

    bb = body.BoundingBox()
    item = {
        "id": entry["id"],
        "class": cls_name,
        "args": args,
        "volume": float(body.Volume()),
        "bbox": [float(bb.xlen), float(bb.ylen), float(bb.zlen)],
        "constants": {
            "curve_points": int(gear.curve_points),
            "surface_splines": int(gear.surface_splines),
            "wire_comb_tol": float(gear.wire_comb_tol),
            "spline_approx_tol": float(gear.spline_approx_tol),
            "spline_approx_min_deg": int(gear.spline_approx_min_deg),
            "spline_approx_max_deg": int(gear.spline_approx_max_deg),
            "shell_sewing_tol": float(gear.shell_sewing_tol),
            "ka": float(gear.ka),
            "kd": float(gear.kd),
        },
    }
    # `derived` / `profile` 是 **best-effort**：只有存在该属性的类才写。
    # BevelGear 没有 r0/ra/rd/rb/rr，Worm/RackGear 没有 twist_angle——这属于「该类本来就
    # 不用这些 SpurGear 专有字段」，不是构造失败。此前无条件读取导致 build() 明明成功了
    # 却被记成 15 个 FAILED（2026-09-12 修正）。缺失字段显式记录，不静默。
    derived_all = ["twist_angle", "r0", "ra", "rd", "rb", "rr", "tau"]
    item["derived"] = {k: float(getattr(gear, k)) for k in derived_all if hasattr(gear, k)}
    derived_missing = [k for k in derived_all if k not in item["derived"]]
    if derived_missing:
        item["derived_missing"] = derived_missing

    profile_all = ["t_lflank_pts", "t_tip_pts", "t_rflank_pts", "t_root_pts"]
    if all(hasattr(gear, k) for k in profile_all):
        item["profile"] = {
            k: [[float(v) for v in p] for p in getattr(gear, k)] for k in profile_all
        }
    else:
        item["profile_missing"] = [k for k in profile_all if not hasattr(gear, k)]

    # 齿面点阵只在齿轮族上抓（Box 没有）
    try:
        item["tooth_face_grids"] = tooth_face_grids(gear, np)
    except Exception as exc:  # pragma: no cover - 诊断用，不静默
        item["tooth_face_grids_error"] = f"{type(exc).__name__}: {exc}"

    cq.exporters.export(body, str(out_dir / f"{entry['id']}.step"))
    return item


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--set", choices=["spike", "regression"], default="spike")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--ids", default="", help="只生成这些 id（逗号分隔）")
    ap.add_argument("--skip-step", action="store_true", help="只出 manifest，不导 STEP")
    args = ap.parse_args()

    src_path = bootstrap_sys_path()

    import cadquery as cq
    import cq_gears
    import numpy as np

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.set == "spike":
        entries = SPIKE_CASES
    else:
        cases_file = Path(
            os.environ.get("FAI_CQ_REGRESSION_CASES", DEFAULT_CQ_REGRESSION_CASES)
        )
        raw = json.loads(cases_file.read_text(encoding="utf-8"))
        entries = [
            {"id": f"case{i:02d}-{c['class']}", "class": c["class"], "args": c["args"]}
            for i, c in enumerate(raw)
        ]
        # regression 用例还带 expected（cq 自带的期望值），原样带过去给 T1
        for i, c in enumerate(raw):
            entries[i]["expected"] = c.get("expected")

    if args.ids:
        wanted = {s.strip() for s in args.ids.split(",") if s.strip()}
        entries = [e for e in entries if e["id"] in wanted]

    manifest = {
        "generator": "cq_gears reference generator",
        "set": args.set,
        "environment": {
            "python": platform.python_version(),
            "cadquery": getattr(cq, "__version__", "unknown"),
            "numpy": np.__version__,
            "cq_gears_file": getattr(cq_gears, "__file__", ""),
            "cq_gears_src_on_sys_path": src_path,
            "cq_gears_src_git_sha": git_sha_of(Path(src_path)) if src_path else "",
        },
        "sample_grid": {"nu": SAMPLE_NU, "nv": SAMPLE_NV},
        "cases": [],
    }

    for e in entries:
        print(f"[gen-reference] building {e['id']} ({e['class']}) …", flush=True)
        try:
            item = build_case(e, out_dir)
        except Exception as exc:
            print(f"  !! FAILED {e['id']}: {type(exc).__name__}: {exc}", file=sys.stderr)
            item = {"id": e["id"], "class": e["class"], "args": e["args"], "error": f"{type(exc).__name__}: {exc}"}
        manifest["cases"].append(item)
        vol = item.get("volume")
        print(f"     volume={vol}")

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(f"\n[gen-reference] wrote {out_dir / 'manifest.json'} "
          f"({len(manifest['cases'])} cases)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
