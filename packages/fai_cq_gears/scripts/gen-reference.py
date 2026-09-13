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
import traceback
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
    # Worm（蜗杆）：单头 + 双头，覆盖 lead_angle 正负两支
    {
        "id": "worm-basic",
        "class": "Worm",
        "args": {"module": 1.0, "lead_angle": 20.0, "n_threads": 1, "length": 10.0},
    },
    {
        "id": "worm-2threads",
        "class": "Worm",
        "args": {"module": 1.0, "lead_angle": 15.0, "n_threads": 2, "length": 10.0},
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

# ── 齿轮对用例集（cq 自身无这些类的回归数据，按移植方案 §9.4 新建）─────────────
# 参数取「与 regression 同风格」的小件（module 1 / face_width 5 / bore_d 3），
# 三例分别覆盖 BevelGearPair 装配的三条分支：
#   bp-basic        齿数 15（奇）→ 不触发绕 Z 的 π/z 对齿旋转
#   bp-even-pinion  齿数 16（偶）→ **触发**绕 Z 的 π/z 对齿旋转
#   bp-angled-helix 轴交角 60°（非 90°）+ 螺旋角 20°（pinion 侧取负）
PAIR_CASES = [
    {
        "id": "bp-basic",
        "class": "BevelGearPair",
        "args": {
            "module": 1.0, "gear_teeth": 30, "pinion_teeth": 15,
            "face_width": 5.0, "bore_d": 3.0,
        },
    },
    {
        "id": "bp-even-pinion",
        "class": "BevelGearPair",
        "args": {
            "module": 1.0, "gear_teeth": 30, "pinion_teeth": 16,
            "face_width": 5.0, "bore_d": 3.0,
        },
    },
    {
        "id": "bp-angled-helix",
        "class": "BevelGearPair",
        "args": {
            "module": 1.0, "gear_teeth": 24, "pinion_teeth": 12,
            "face_width": 5.0, "axis_angle": 60.0, "helix_angle": 20.0,
            "bore_d": 3.0,
        },
    },
]

# ── 新移植类用例集（2026-09-13 续移植：覆盖剩余 5 类）─────────────────────────
# 与 pairs 同风格的小件参数（module 1 / width 5），分别覆盖：
#   hg-basic   单件双曲面齿轮（HyperbolicGear）——走单体 build_case 路径
#   cgp-basic  交错轴斜齿轮对（CrossedGearPair）——shaft_angle 90°，两齿数相同
#   hgp-basic  双曲面齿轮对（HyperbolicGearPair）——shaft_angle 90°，g2 缺省= g1
#   pg-basic   行星轮系（PlanetaryGearset）——太阳 20 / 行星 20 / 3 行星
#   hpg-basic  人字行星轮系（HerringbonePlanetaryGearset）——同上
# 路由规则（main 内）：class 以 "Pair" 结尾 → build_pair_case；以 "Gearset" 结尾 →
# build_gearset_case；其余（含 hg-basic 的 HyperbolicGear）→ build_case。
GEARSET_CASES = [
    {
        "id": "hg-basic",
        "class": "HyperbolicGear",
        "args": {"module": 1.0, "teeth_number": 20, "width": 5.0, "twist_angle": 30.0},
    },
    {
        "id": "cgp-basic",
        "class": "CrossedGearPair",
        "args": {
            "module": 1.0, "gear1_teeth_number": 20, "gear2_teeth_number": 20,
            "gear1_width": 5.0, "gear2_width": 5.0, "shaft_angle": 90.0,
        },
    },
    {
        "id": "hgp-basic",
        "class": "HyperbolicGearPair",
        "args": {
            "module": 1.0, "gear1_teeth_number": 20, "width": 5.0, "shaft_angle": 90.0,
        },
    },
    {
        "id": "pg-basic",
        "class": "PlanetaryGearset",
        "args": {
            "module": 1.0, "sun_teeth_number": 20, "planet_teeth_number": 20,
            "width": 5.0, "rim_width": 5.0, "n_planets": 3,
        },
    },
    {
        "id": "hpg-basic",
        "class": "HerringbonePlanetaryGearset",
        "args": {
            "module": 1.0, "sun_teeth_number": 20, "planet_teeth_number": 20,
            "width": 5.0, "rim_width": 5.0, "n_planets": 3,
        },
    },
]


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


def part_info(name, gear_obj, solid, np):
    """单件（`*Pair` / `*Gearset` 的成员）的实测几何量。

    `solid` 必须是**装配后**的那一件（pinion/planet 已被 `Location` 定位），
    故这里的 volume/bbox/center 就是最终位姿下的真值。

    ⚠️ 不同齿轮类的成员字段不同：Bevel 有 `cone_h`/`gamma_p`/`gs_r`，
    Crossed/Hyperbolic 有 `throat_r`，都没有的成员字段**显式跳过**（用 `hasattr`），
    不静默、不报错——这是 2026-09-12 修正的「best-effort 导出」原则。
    """
    bb = solid.BoundingBox()
    c = bb.center  # `BoundBox.center` 是 property（返回 Vector），不是方法
    item = {
        "name": name,
        "volume": float(solid.Volume()),
        "bbox": [float(bb.xlen), float(bb.ylen), float(bb.zlen)],
        "bbox_min": [float(bb.xmin), float(bb.ymin), float(bb.zmin)],
        "bbox_max": [float(bb.xmax), float(bb.ymax), float(bb.zmax)],
        "center": [float(c.x), float(c.y), float(c.z)],
        "z": int(gear_obj.z),
        "surface_splines": int(gear_obj.surface_splines),
        "has_twist_angle": hasattr(gear_obj, "twist_angle"),
    }
    if hasattr(gear_obj, "cone_h"):
        item["cone_h"] = float(gear_obj.cone_h)
    if hasattr(gear_obj, "gamma_p"):
        item["cone_angle_deg"] = float(np.degrees(gear_obj.gamma_p))
    if hasattr(gear_obj, "gs_r"):
        item["gs_r"] = float(gear_obj.gs_r)
    if hasattr(gear_obj, "throat_r"):
        item["throat_r"] = float(gear_obj.throat_r)
    return item


def build_pair_case(entry, out_dir: Path):
    """构建一个**齿轮对**用例（`*Pair` 类：Bevel / Crossed / Hyperbolic）。

    与 `build_case` 的差别：
      * `build()` 返回的是装配 Compound（多 solid），故 `volume`/`bbox` 是**整体**值
        （compound 体积 = 各件之和），另外在 `parts` 里逐件记录真值——T1 逐件比对、
        T2 也按 leaves 逐件比对，两边都要有基准。
      * 对类没有 `twist_angle` / `t_*_pts`（这些是单体类的字段），
        齿面点阵与齿廓导出**显式跳过并写明原因**，不静默。
      * 成员命名：BevelGearPair 用 `gear`/`pinion`，Crossed/Hyperbolic 用 `gear1`/`gear2`——
        用 `hasattr` 探测，不写死（与 fai 侧 `bevelPairExportParts`/`*PairExportParts`
        的命名一致：A/B 两侧 STEP 都按索引配对（matchNames:false），命名只用于 manifest 报告）。

    ⚠️ 装配 Compound 的 solid 顺序 = 装配 add 顺序（gear1 先、gear2 后）。fai 侧
    `export-ours.ts` 的 `*PairExportParts` 返回顺序也是 gear1→gear2，故 STEP 逐件对齐。
    """
    import cadquery as cq
    import cq_gears
    import numpy as np

    cls = getattr(cq_gears, entry["class"])
    pair = cls(**entry["args"])
    # 用 `assemble()` 拿命名装配（成员名 gear1/gear2），再 `toCompound()` 取实体；
    # 导出走 `asm.save()`（带名产品），使参考侧 leaf 名与 fai 侧
    # `exportStepFromSolids(parts)` 的产品名一致。compareAssemblyFiles 在
    # matchNames:false 下按「排序名」配对，两边同名 ⇒ 索引配对正确
    # （否则 foreign 默认名会被按字母序错配，导致轮系/对类误判 DIFFERENT）。
    asm = pair.assemble()
    body = asm.toCompound()

    solids = body.Solids()
    if len(solids) != 2:
        raise ValueError(f"expected 2 solids in pair compound, got {len(solids)}")

    # BevelGearPair 暴露 .gear/.pinion；Crossed/Hyperbolic 暴露 .gear1/.gear2。
    is_bevel = hasattr(pair, "gear")
    g1 = pair.gear if is_bevel else pair.gear1
    g2 = pair.pinion if is_bevel else pair.gear2
    names = ("gear", "pinion") if is_bevel else ("gear1", "gear2")

    bb = body.BoundingBox()
    item = {
        "id": entry["id"],
        "class": entry["class"],
        "args": entry["args"],
        "volume": float(body.Volume()),
        "bbox": [float(bb.xlen), float(bb.ylen), float(bb.zlen)],
        "parts": [
            part_info(names[0], g1, solids[0], np),
            part_info(names[1], g2, solids[1], np),
        ],
        "constants": {
            "curve_points": int(pair.curve_points),
            "surface_splines": int(pair.surface_splines),
            "wire_comb_tol": float(pair.wire_comb_tol),
            "spline_approx_tol": float(pair.spline_approx_tol),
            "spline_approx_min_deg": int(pair.spline_approx_min_deg),
            "spline_approx_max_deg": int(pair.spline_approx_max_deg),
            "shell_sewing_tol": float(pair.shell_sewing_tol),
            "ka": float(pair.ka),
            "kd": float(pair.kd),
        },
        "tooth_face_grids_skipped": ("pair class has no single twist_angle / "
                                     "t_*_pts; see parts[] for per-member geometry"),
    }

    # 装配参数：Bevel 记锥角/锥高（best-effort，其余对类没有这些字段）；
    # 非 Bevel 记 shaft_angle 与两件齿数/扭转角，供「gear2 定位链」复现。
    if is_bevel:
        item["assembly"] = {
            "axis_angle_rad": float(getattr(pair, "axis_angle", np.radians(90.0))),
            "gear_cone_h": float(pair.gear.cone_h),
            "pinion_cone_h": float(pair.pinion.cone_h),
            "gear_cone_angle_deg": float(np.degrees(pair.gear.gamma_p)),
            "pinion_cone_angle_deg": float(np.degrees(pair.pinion.gamma_p)),
        }
    else:
        item["assembly"] = {
            "shaft_angle_rad": float(getattr(pair, "shaft_angle", np.radians(90.0))),
            "g1_z": int(g1.z),
            "g2_z": int(g2.z),
            "g1_twist_deg": float(np.degrees(g1.twist_angle)),
            "g2_twist_deg": float(np.degrees(g2.twist_angle)),
        }

    # 保险：pair 若将来带上单件字段，照旧导出（当前 *Pair 都没有）。
    profile_all = ["t_lflank_pts", "t_tip_pts", "t_rflank_pts", "t_root_pts"]
    if all(hasattr(pair, k) for k in profile_all):
        item["profile"] = {
            k: [[float(v) for v in p] for p in getattr(pair, k)] for k in profile_all
        }

    # 导出**带名**装配 STEP（每件一个命名产品，名 gear1/gear2 或 gear/pinion），
    # 与 fai 侧 `exportStepFromSolids(parts)` 产品名一致 → matchNames:false 下
    # 按排序名配对时索引对齐，避免轮系/对类误判 DIFFERENT。
    asm.save(str(out_dir / f"{entry['id']}.step"))
    return item


def build_gearset_case(entry, out_dir: Path):
    """构建一个**轮系**用例（`PlanetaryGearset` / `HerringbonePlanetaryGearset`）。

    与 `build_pair_case` 同理（`build()` → 装配 Compound 多 solid），但件数更多：
      太阳 1 件 + 行星 n 件 + 内齿圈 1 件 = n+2 件，
      solid 顺序 = 装配 add 顺序（sun → planet_00..planet_NN → ring）。

    fai 侧 `planetaryExportParts` 返回顺序同样是 sun → planet_00.. → ring，
    故 STEP 逐件对齐（matchNames:false 按索引配对）。
    """
    import cadquery as cq
    import cq_gears
    import numpy as np

    cls = getattr(cq_gears, entry["class"])
    gearset = cls(**entry["args"])
    # 命名装配（成员名 sun/planet_NN/ring）→ 带名产品 STEP，与 fai 侧产品名一致。
    asm = gearset.assemble()
    body = asm.toCompound()

    n_planets = int(entry["args"].get("n_planets", 0))
    expected = 2 + n_planets  # sun + planets + ring
    solids = body.Solids()
    if len(solids) != expected:
        raise ValueError(
            f"expected {expected} solids in gearset compound "
            f"(sun+{n_planets} planets+ring), got {len(solids)}"
        )

    bb = body.BoundingBox()
    names = ["sun"] + [f"planet_{i:02d}" for i in range(n_planets)] + ["ring"]
    # 几何真值来源：sun/planet/ring 三件各自一份（所有行星共享 planet 几何）。
    member_objs = [gearset.sun] + [gearset.planet] * n_planets + [gearset.ring]
    item = {
        "id": entry["id"],
        "class": entry["class"],
        "args": entry["args"],
        "volume": float(body.Volume()),
        "bbox": [float(bb.xlen), float(bb.ylen), float(bb.zlen)],
        "n_planets": n_planets,
        "parts": [
            part_info(name, gobj, solid, np)
            for name, gobj, solid in zip(names, member_objs, solids)
        ],
        "constants": {
            "curve_points": int(gearset.curve_points),
            "surface_splines": int(gearset.surface_splines),
            "wire_comb_tol": float(gearset.wire_comb_tol),
            "spline_approx_tol": float(gearset.spline_approx_tol),
            "spline_approx_min_deg": int(gearset.spline_approx_min_deg),
            "spline_approx_max_deg": int(gearset.spline_approx_max_deg),
            "shell_sewing_tol": float(gearset.shell_sewing_tol),
            "ka": float(gearset.ka),
            "kd": float(gearset.kd),
        },
        "tooth_face_grids_skipped": ("gearset class has no single twist_angle / "
                                     "t_*_pts; see parts[] for per-member geometry"),
    }

    cq.exporters.export(body, str(out_dir / f"{entry['id']}.step"))
    return item


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--set", choices=["spike", "regression", "pairs", "gearsets"], default="spike")
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
    elif args.set == "pairs":
        entries = PAIR_CASES
    elif args.set == "gearsets":
        entries = GEARSET_CASES
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
            # `*Pair` → 装配路径（多 solid、逐件真值）；
            # `*Gearset` → 轮系路径（多 solid、逐件真值）；
            # 其余（含 HyperbolicGear 单体）→ 单体路径。
            if e["class"].endswith("Pair"):
                builder = build_pair_case
            elif e["class"].endswith("Gearset"):
                builder = build_gearset_case
            else:
                builder = build_case
            item = builder(e, out_dir)
        except Exception as exc:
            print(f"  !! FAILED {e['id']}: {type(exc).__name__}: {exc}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
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
