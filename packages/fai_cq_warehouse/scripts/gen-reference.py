#! /usr/bin/env python3
"""
gen-reference.py — 生成 cq_warehouse（CadQuery / OCP）侧的参考数据，供
fai_cq_warehouse 的一致性测试使用（A 侧真值管线，照 fai_cq_gears 同名脚本范式）。

产出（默认写到 <pkg>/fixtures/reference/）：
  * manifest.json   —— 每个用例的 volume / bbox / 质心 / 零件树（parts[]，含顺序）
                       / 构造参数 / 环境版本 / 上游 git HEAD
  * <case-id>.step  —— CadQuery 导出的 STEP（等价性比对的 A 侧）

用法：
    python scripts/gen-reference.py [--set smoke|full] [--out DIR] [--ids id1,id2]
环境变量：
    FAI_CQ_PYTHON    解释器路径（由 gen-reference.ps1 设置）
    FAI_CQ_UPSTREAM  cq_warehouse 源码目录（默认 C:\\git\\CADQ\\cq_warehouse\\src）
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
DEFAULT_CQ_WAREHOUSE_SRC = Path(r"C:\git\CADQ\cq_warehouse\src")

# ── smoke 用例集（W0：每类 1–2 例，日常回归）────────────────────────────────
# 体积真值来自方案 §2.6 的实测（2026-09-13）：
#   Sprocket 16T                  → 6552.2962
# ⚠️ 原 `hexnut-m6-iso4032`（HexNut M6-1/iso4032，实测 302.297726）已**移入**
#    NUT_CASES —— 一个事实一个家：该用例归螺母族，跑 `--set nut` 时一并生成；
#    manifest 按 id upsert，历史 STEP 不丢。
SMOKE_CASES = [
    {
        "id": "sprocket-16t",
        "class": "Sprocket",
        "args": {"num_teeth": 16, "chain_pitch": 12.7, "roller_diameter": 7.9375},
        "expect_volume": 6552.2962,
    },
]

# ── W3 螺纹用例集（方案 §8 W3 验收：四类各 2–3 规格 + external / hand 各 1 例）──
# 参数逐字取自上游 signature（thread.py:68 Thread / :471 IsoThread /
# :583 TrapezoidalThread / :926 PlasticBottleThread）；默认值不写进 args，
# 由 B 侧 reference-options.ts 用同一份默认值补齐（args→options 唯一真源）。
THREAD_CASES = [
    # IsoThread：默认 end_finishes=("fade","square")，四类端部组合各覆盖一例
    {"id": "iso-m6x1-fade-square", "class": "IsoThread",
     "args": {"major_diameter": 6, "pitch": 1, "length": 10}},
    {"id": "iso-m6x1-fade-fade", "class": "IsoThread",
     "args": {"major_diameter": 6, "pitch": 1, "length": 10, "end_finishes": ["fade", "fade"]}},
    {"id": "iso-m6x1-square-square", "class": "IsoThread",
     "args": {"major_diameter": 6, "pitch": 1, "length": 10, "end_finishes": ["square", "square"]}},
    {"id": "iso-m6x1-raw-raw", "class": "IsoThread",
     "args": {"major_diameter": 6, "pitch": 1, "length": 10, "end_finishes": ["raw", "raw"]}},
    {"id": "iso-m10x1.5-fade-square", "class": "IsoThread",
     "args": {"major_diameter": 10, "pitch": 1.5, "length": 20}},
    {"id": "iso-m30x3.5-fade-square", "class": "IsoThread",
     "args": {"major_diameter": 30, "pitch": 3.5, "length": 25}},
    {"id": "iso-m6x1-internal", "class": "IsoThread",
     "args": {"major_diameter": 6, "pitch": 1, "length": 10, "external": False}},
    {"id": "iso-m6x1-lefthand", "class": "IsoThread",
     "args": {"major_diameter": 6, "pitch": 1, "length": 10, "hand": "left"}},
    # AcmeThread：默认 end_finishes=("fade","fade")，thread_angle=29
    {"id": "acme-1_2-fade-fade", "class": "AcmeThread",
     "args": {"size": "1/2", "length": 10}},
    {"id": "acme-3_4-fade-fade", "class": "AcmeThread",
     "args": {"size": "3/4", "length": 16}},
    {"id": "acme-1-fade-fade", "class": "AcmeThread",
     "args": {"size": "1", "length": 25}},
    # MetricTrapezoidalThread：thread_angle=30
    {"id": "mtrap-20x4-fade-fade", "class": "MetricTrapezoidalThread",
     "args": {"size": "20x4", "length": 20}},
    {"id": "mtrap-40x7-fade-fade", "class": "MetricTrapezoidalThread",
     "args": {"size": "40x7", "length": 40}},
    # PlasticBottleThread：end_finishes 恒为 ("fade","fade")，length 由 finish_data 推出
    {"id": "pbt-M38SP444", "class": "PlasticBottleThread",
     "args": {"size": "M38SP444"}},
    {"id": "pbt-L38SP444", "class": "PlasticBottleThread",
     "args": {"size": "L38SP444"}},
    {"id": "pbt-M38SP444-internal", "class": "PlasticBottleThread",
     "args": {"size": "M38SP444", "external": False}},
    # Thread 通用类（apex/root 半径直接给定）
    {"id": "thread-generic-raw-raw", "class": "Thread",
     "args": {"apex_radius": 3.0, "apex_width": 0.125, "root_radius": 2.458734122634726,
              "root_width": 0.75, "pitch": 1.0, "length": 10.0,
              "end_finishes": ["raw", "raw"]}},
]

# ── W4 螺母 + 垫圈用例集（方案 §8 W4 验收：7 类螺母 × 2 规格 + 3 类垫圈）──
# 参数逐字取自上游 signature（fastener.py:520 `Nut.__init__` / :2235 `Washer.__init__`）；
# `simple` 默认 True（不建螺纹）→ 主体用例不带螺纹，螺纹复用例单列末尾。
# 每类的 (fastener_type, size) 组合均按上游 `Nut.sizes()` 语义实测存在性。
NUT_CASES = [
    # HexNut：方案指定 M6-1/iso4032 必过（实测 302.297726）
    {"id": "hexnut-m6-iso4032", "class": "HexNut",
     "args": {"size": "M6-1", "fastener_type": "iso4032"}, "expect_volume": 302.297726},
    {"id": "nut-hex-m3-iso4032", "class": "HexNut",
     "args": {"size": "M3-0.5", "fastener_type": "iso4032"}},
    # HexNutWithFlange：带法兰分支（`flange_profile`，fastener.py:1139）
    {"id": "nut-hexflange-m6-din1665", "class": "HexNutWithFlange",
     "args": {"size": "M6-1", "fastener_type": "din1665"}},
    {"id": "nut-hexflange-m8-din1665", "class": "HexNutWithFlange",
     "args": {"size": "M8-1.25", "fastener_type": "din1665"}},
    # DomedCapNut：球顶轮廓（`radiusArc` 双弧收口，fastener.py:699-703）
    {"id": "nut-domed-m6-din1587", "class": "DomedCapNut",
     "args": {"size": "M6-1", "fastener_type": "din1587"}},
    {"id": "nut-domed-m4-din1587", "class": "DomedCapNut",
     "args": {"size": "M4-0.7", "fastener_type": "din1587"}},
    # UnchamferedHexagonNut：无倒角矩形轮廓
    {"id": "nut-unchamfer-m6-iso4036", "class": "UnchamferedHexagonNut",
     "args": {"size": "M6-1", "fastener_type": "iso4036"}},
    {"id": "nut-unchamfer-m3-iso4036", "class": "UnchamferedHexagonNut",
     "args": {"size": "M3-0.5", "fastener_type": "iso4036"}},
    # SquareNut：四方轮廓（`polygon_diagonal(s, 4)`）
    {"id": "nut-square-m6-din557", "class": "SquareNut",
     "args": {"size": "M6-1", "fastener_type": "din557"}},
    {"id": "nut-square-m5-din557", "class": "SquareNut",
     "args": {"size": "M5-0.8", "fastener_type": "din557"}},
    # BradTeeNut：唯一走 `custom_make`（polarArray + clearanceHole）
    # 两规格（方案 §8-W4 验收要求 7 类各 ≥2 规格）；M8 的 brad_size 同为 M4-0.7、c 不同
    {"id": "nut-bradtee-m6-hilitchi", "class": "BradTeeNut",
     "args": {"size": "M6-1", "fastener_type": "Hilitchi"}, "expect_volume": 3389.175287},
    {"id": "nut-bradtee-m8-hilitchi", "class": "BradTeeNut",
     "args": {"size": "M8-1.25", "fastener_type": "Hilitchi"}},
    # HeatSetNut：唯一走 makeNSidedSurface knurl + Shell.makeShell 的路径
    {"id": "nut-heatset-m3-mcmaster", "class": "HeatSetNut",
     "args": {"size": "M3-0.5-Standard", "fastener_type": "McMaster-Carr"}},
    {"id": "nut-heatset-m2-mcmaster", "class": "HeatSetNut",
     "args": {"size": "M2-0.4-Short", "fastener_type": "McMaster-Carr"}},
    # simple=False（带螺纹）—— 验证 W3 螺纹在 nut 内的复用（`union(IsoThread(...))`）
    {"id": "nut-hex-m6-iso4032-threaded", "class": "HexNut",
     "args": {"size": "M6-1", "fastener_type": "iso4032", "simple": False}},
]

# ── W6 轴承用例集（方案 §8 W6 验收：5 类 × ≥2 规格；M8-22-7/SKT 必过）──
# 参数逐字取自上游 signature（bearing.py:194 `Bearing.__init__`：size / bearing_type）。
# 所有类的唯一 bearing_type 均为 "SKT"（实测 `Bearing.types()`）。
BEARING_CASES = [
    # SingleRowDeepGrooveBallBearing：球滚子 + 默认矩形圆角滚道；M8-22-7 为方案指定必过例
    {"id": "bearing-dgb-m8-22-7", "class": "SingleRowDeepGrooveBallBearing",
     "args": {"size": "M8-22-7", "bearing_type": "SKT"}, "expect_volume": 1644.7491},
    {"id": "bearing-dgb-m6-19-6", "class": "SingleRowDeepGrooveBallBearing",
     "args": {"size": "M6-19-6", "bearing_type": "SKT"}},
    # SingleRowCappedDeepGrooveBallBearing：deep groove + 两端密封盖（cap × 2）
    {"id": "bearing-capped-m8-22-7", "class": "SingleRowCappedDeepGrooveBallBearing",
     "args": {"size": "M8-22-7", "bearing_type": "SKT"}},
    {"id": "bearing-capped-m6-19-6", "class": "SingleRowCappedDeepGrooveBallBearing",
     "args": {"size": "M6-19-6", "bearing_type": "SKT"}},
    # SingleRowAngularContactBallBearing：自定义 spline+arc 滚道 + cap（D2/d2）
    {"id": "bearing-acb-m10-30-9", "class": "SingleRowAngularContactBallBearing",
     "args": {"size": "M10-30-9", "bearing_type": "SKT"}},
    {"id": "bearing-acb-m15-35-11", "class": "SingleRowAngularContactBallBearing",
     "args": {"size": "M15-35-11", "bearing_type": "SKT"}},
    # SingleRowCylindricalRollerBearing：圆柱滚子 + 默认矩形圆角滚道
    {"id": "bearing-cyl-m15-35-11", "class": "SingleRowCylindricalRollerBearing",
     "args": {"size": "M15-35-11", "bearing_type": "SKT"}},
    {"id": "bearing-cyl-m17-40-12", "class": "SingleRowCylindricalRollerBearing",
     "args": {"size": "M17-40-12", "bearing_type": "SKT"}},
    # SingleRowTaperedRollerBearing：trapezoid 旋转滚道 + 圆锥滚子 + cage
    {"id": "bearing-taper-m15-42-14.25", "class": "SingleRowTaperedRollerBearing",
     "args": {"size": "M15-42-14.25", "bearing_type": "SKT"}},
    {"id": "bearing-taper-m17-40-13.25", "class": "SingleRowTaperedRollerBearing",
     "args": {"size": "M17-40-13.25", "bearing_type": "SKT"}},
]

# ── W5 螺钉用例集（方案 §8 W5 验收：12 类 × 2 规格，simple=True/False 各覆盖，
#    CounterSunkScrew 与 SetScrew 单列）────────────────────────────────────────
# 参数逐字取自上游 signature（fastener.py:1416 `Screw.__init__`）。
# fastener_type 的选择刻意避开 PH（cross）沉孔——该路径需要 30° 锥度切割器，
# 在截面臂宽退化为 0 后内核（LocOpe_DPrism）才能继续，本包 draftPrism 无法复刻
# （W5 已知缺口，见 screw.ts 文件头）。PH-only 的两类照 W4·HeatSetNut 先例，
# 保留 A 侧用例、B 侧断言抛错。
SCREW_CASES = [
    # ButtonHeadScrew（rf 圆弧头 + hex 沉孔）
    {"id": "screw-button-m6-iso7380_1", "class": "ButtonHeadScrew",
     "args": {"size": "M6-1", "length": 16, "fastener_type": "iso7380_1"}},
    {"id": "screw-button-m4-iso7380_1", "class": "ButtonHeadScrew",
     "args": {"size": "M4-0.7", "length": 12, "fastener_type": "iso7380_1"}},
    # ButtonHeadWithCollarScrew（fillet2D + 自定义 countersink，读 dc）
    {"id": "screw-buttoncollar-m6-iso7380_2", "class": "ButtonHeadWithCollarScrew",
     "args": {"size": "M6-1", "length": 16, "fastener_type": "iso7380_2"}},
    {"id": "screw-buttoncollar-m4-iso7380_2", "class": "ButtonHeadWithCollarScrew",
     "args": {"size": "M4-0.7", "length": 12, "fastener_type": "iso7380_2"}},
    # CheeseHeadScrew：iso1207（slot）/ iso14580（T）——5° 收顶 + fillet2D
    {"id": "screw-cheese-m6-iso1207", "class": "CheeseHeadScrew",
     "args": {"size": "M6-1", "length": 25, "fastener_type": "iso1207"}},
    {"id": "screw-cheese-m4-iso1207", "class": "CheeseHeadScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "iso1207"}},
    {"id": "screw-cheese-m6-iso14580", "class": "CheeseHeadScrew",
     "args": {"size": "M6-1", "length": 25, "fastener_type": "iso14580"}},
    # CounterSunkScrew（单列：length_offset=k，头含在 length 内；a/dk/k 锥角最易错）
    {"id": "screw-csk-m6-iso10642", "class": "CounterSunkScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso10642"}},
    {"id": "screw-csk-m4-iso10642", "class": "CounterSunkScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "iso10642"}},
    {"id": "screw-csk-m6-iso2009", "class": "CounterSunkScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso2009"}},
    {"id": "screw-csk-m6-iso14582", "class": "CounterSunkScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso14582"}},
    {"id": "screw-csk-m6-iso10642-left", "class": "CounterSunkScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso10642", "hand": "left"}},
    # HexHeadScrew（head_plan 六角 + socket_clearance）
    {"id": "screw-hexhead-m6-iso4017", "class": "HexHeadScrew",
     "args": {"size": "M6-1", "length": 30, "fastener_type": "iso4017"}},
    {"id": "screw-hexhead-m4-iso4017", "class": "HexHeadScrew",
     "args": {"size": "M4-0.7", "length": 20, "fastener_type": "iso4017"}},
    {"id": "screw-hexhead-m6-iso4014", "class": "HexHeadScrew",
     "args": {"size": "M6-1", "length": 30, "fastener_type": "iso4014"}},
    # HexHeadWithFlangeScrew（flange_profile 25° 切线弧）
    {"id": "screw-hexflange-m6-din1665", "class": "HexHeadWithFlangeScrew",
     "args": {"size": "M6-1", "length": 25, "fastener_type": "din1665"}},
    {"id": "screw-hexflange-m8-din1665", "class": "HexHeadWithFlangeScrew",
     "args": {"size": "M8-1.25", "length": 30, "fastener_type": "din1665"}},
    # PanHeadScrew（spline 头型：iso1580 slot / iso14583 T）
    {"id": "screw-pan-m6-iso1580", "class": "PanHeadScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso1580"}},
    {"id": "screw-pan-m4-iso1580", "class": "PanHeadScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "iso1580"}},
    {"id": "screw-pan-m6-iso14583", "class": "PanHeadScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso14583"}},
    # PanHeadWithCollarScrew：唯一类型 din967 是 PH（cross）——W5 已知缺口（B 侧抛错）
    # 取 2 规格（M6 / M4）：验收要求「12 类 × ≥2 规格」，缺口类也得凑齐才算覆盖
    {"id": "screw-pancollar-m6-din967", "class": "PanHeadWithCollarScrew",
     "args": {"size": "M6-1", "length": 16, "fastener_type": "din967"}},
    {"id": "screw-pancollar-m4-din967", "class": "PanHeadWithCollarScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "din967"}},
    # RaisedCheeseHeadScrew：唯一类型 iso7045 是 PH（cross）——W5 已知缺口（B 侧抛错）
    {"id": "screw-raisedcheese-m6-iso7045", "class": "RaisedCheeseHeadScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso7045"}},
    {"id": "screw-raisedcheese-m4-iso7045", "class": "RaisedCheeseHeadScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "iso7045"}},
    # RaisedCounterSunkOvalHeadScrew（length_offset=k + 椭圆顶；iso2010 slot / iso14584 T）
    {"id": "screw-rcos-m6-iso2010", "class": "RaisedCounterSunkOvalHeadScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso2010"}},
    {"id": "screw-rcos-m4-iso2010", "class": "RaisedCounterSunkOvalHeadScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "iso2010"}},
    {"id": "screw-rcos-m6-iso14584", "class": "RaisedCounterSunkOvalHeadScrew",
     "args": {"size": "M6-1", "length": 20, "fastener_type": "iso14584"}},
    # SetScrew（单列：custom_make 无头螺钉；core=带 hex 孔的管 + 镜像）
    {"id": "screw-setscrew-m6-iso4026", "class": "SetScrew",
     "args": {"size": "M6-1", "length": 12, "fastener_type": "iso4026"}},
    {"id": "screw-setscrew-m8-iso4026", "class": "SetScrew",
     "args": {"size": "M8-1.25", "length": 16, "fastener_type": "iso4026"}},
    # SocketHeadCapScrew（圆柱头 + hex 沉孔）；simple=False 复用 W3 螺纹
    {"id": "screw-shcs-m6-iso4762", "class": "SocketHeadCapScrew",
     "args": {"size": "M6-1", "length": 25, "fastener_type": "iso4762"}},
    {"id": "screw-shcs-m4-iso4762", "class": "SocketHeadCapScrew",
     "args": {"size": "M4-0.7", "length": 16, "fastener_type": "iso4762"}},
    {"id": "screw-shcs-m6-iso4762-threaded", "class": "SocketHeadCapScrew",
     "args": {"size": "M6-1", "length": 25, "fastener_type": "iso4762", "simple": False}},
]

WASHER_CASES = [
    # PlainWasher：4 个 fastener_type 取 2（本体 + 特大系列）
    {"id": "washer-plain-m6-iso7089", "class": "PlainWasher",
     "args": {"size": "M6", "fastener_type": "iso7089"}},
    {"id": "washer-plain-m6-iso7094", "class": "PlainWasher",
     "args": {"size": "M6", "fastener_type": "iso7094"}},
    # ChamferedWasher：单类型，取 2 规格
    {"id": "washer-chamfer-m6-iso7090", "class": "ChamferedWasher",
     "args": {"size": "M6", "fastener_type": "iso7090"}},
    {"id": "washer-chamfer-m8-iso7090", "class": "ChamferedWasher",
     "args": {"size": "M8", "fastener_type": "iso7090"}},
    # CheeseHeadWasher：单类型，取 2 规格
    {"id": "washer-cheese-m6-iso7092", "class": "CheeseHeadWasher",
     "args": {"size": "M6", "fastener_type": "iso7092"}},
    {"id": "washer-cheese-m4-iso7092", "class": "CheeseHeadWasher",
     "args": {"size": "M4", "fastener_type": "iso7092"}},
]

# 类名 → 模块（上游所有类都在 cq_warehouse.<模块>）
CLASS_MODULES = {
    "Sprocket": "cq_warehouse.sprocket",
    # 螺母 7 类 + 垫圈 3 类（W4）——上游全部定义在 fastener.py
    "HexNut": "cq_warehouse.fastener",
    "HexNutWithFlange": "cq_warehouse.fastener",
    "DomedCapNut": "cq_warehouse.fastener",
    "UnchamferedHexagonNut": "cq_warehouse.fastener",
    "SquareNut": "cq_warehouse.fastener",
    "BradTeeNut": "cq_warehouse.fastener",
    "HeatSetNut": "cq_warehouse.fastener",
    "PlainWasher": "cq_warehouse.fastener",
    "ChamferedWasher": "cq_warehouse.fastener",
    "CheeseHeadWasher": "cq_warehouse.fastener",
    # 螺钉 12 类（W5）——上游全部定义在 fastener.py
    "ButtonHeadScrew": "cq_warehouse.fastener",
    "ButtonHeadWithCollarScrew": "cq_warehouse.fastener",
    "CheeseHeadScrew": "cq_warehouse.fastener",
    "CounterSunkScrew": "cq_warehouse.fastener",
    "HexHeadScrew": "cq_warehouse.fastener",
    "HexHeadWithFlangeScrew": "cq_warehouse.fastener",
    "PanHeadScrew": "cq_warehouse.fastener",
    "PanHeadWithCollarScrew": "cq_warehouse.fastener",
    "RaisedCheeseHeadScrew": "cq_warehouse.fastener",
    "RaisedCounterSunkOvalHeadScrew": "cq_warehouse.fastener",
    "SetScrew": "cq_warehouse.fastener",
    "SocketHeadCapScrew": "cq_warehouse.fastener",
    # 螺纹 5 类（W3）
    "Thread": "cq_warehouse.thread",
    "IsoThread": "cq_warehouse.thread",
    "AcmeThread": "cq_warehouse.thread",
    "MetricTrapezoidalThread": "cq_warehouse.thread",
    "PlasticBottleThread": "cq_warehouse.thread",
    # 轴承 5 类（W6）——上游全部定义在 bearing.py
    "SingleRowDeepGrooveBallBearing": "cq_warehouse.bearing",
    "SingleRowCappedDeepGrooveBallBearing": "cq_warehouse.bearing",
    "SingleRowAngularContactBallBearing": "cq_warehouse.bearing",
    "SingleRowCylindricalRollerBearing": "cq_warehouse.bearing",
    "SingleRowTaperedRollerBearing": "cq_warehouse.bearing",
}

CASE_SETS = {
    "smoke": SMOKE_CASES,
    "thread": THREAD_CASES,
    "nut": NUT_CASES,
    "washer": WASHER_CASES,
    "screw": SCREW_CASES,
    "bearing": BEARING_CASES,
}


def bootstrap_sys_path() -> str:
    """把 cq_warehouse 源码目录插进 sys.path（免 pip install，照 fai_cq_gears 先例）。"""
    src = Path(os.environ.get("FAI_CQ_UPSTREAM", str(DEFAULT_CQ_WAREHOUSE_SRC)))
    if not src.exists():
        print(f"[gen-reference] upstream src not found: {src}", file=sys.stderr)
        sys.exit(2)
    sys.path.insert(0, str(src))
    return str(src)


def git_sha_of(path: Path) -> str | None:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=str(path), stderr=subprocess.DEVNULL
            )
            .decode()
            .strip()
        )
    except Exception:
        return None


def exact_bbox(shape):
    """精确包围盒（**不**读三角化），返回 (xmin, ymin, zmin, xmax, ymax, zmax)。

    ⚠️ 不要用 `shape.BoundingBox()`：cadquery 的实现是
    `BRepBndLib::AddOptimal(shape, box, useTriangulation=True, ...)`——只要 shape
    上已有三角化（`tessellate()` **原地**建三角化），它就改读三角化包围盒，
    实测比精确几何**大** 0.1%–0.2%（M6 螺纹 +0.0126、40×7 梯形螺纹 +0.0828、
    M6 螺母 +0.0156）。精确量与调用顺序因此必须解耦：本函数显式
    `useTriangulation=False`，与 `volume_mesh` 谁先谁后无关。
    见 docs/analysis/2026-09-14-cq-warehouse-thread-probe.md。
    """
    from OCP.Bnd import Bnd_Box  # noqa: PLC0415 — 延迟 import，让 --help 不依赖环境
    from OCP.BRepBndLib import BRepBndLib  # noqa: PLC0415

    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape.wrapped, box, False, False)
    return box.Get()


def bbox_of(shape) -> list[float]:
    xmin, ymin, zmin, xmax, ymax, zmax = exact_bbox(shape)
    return [float(xmax - xmin), float(ymax - ymin), float(zmax - zmin)]


def mesh_volume_of(shape, tol: float = 0.002) -> float:
    """三角化体积（独立于 `BRepGProp`）。

    ⚠️ 为什么需要第二条体积基准（2026-09-14 实测，docs/analysis/
    2026-09-14-cq-warehouse-thread-probe.md）：上游 `Thread` 的实体由
    `Face.makeRuledSurface`（实为 `BRepFill::Shell`）的 4 条带 + 2 端帽缝成，
    其 **GProps 解析体积与自身三角化体积可差 0.001%–6.6%**，且随圈数非单调
    （长度扫描 raw：L=10→34.97、L=11→49.96、L=12→39.18）。三角化 + 解析
    螺旋扫掠积分 + 我方构造三者一致，GProps 是离群值，故以 `volume_mesh` 为准。
    """
    verts, tris = shape.tessellate(tol)
    pts = [(p.x, p.y, p.z) for p in verts]
    total = 0.0
    for a, b, c in tris:
        ax, ay, az = pts[a]
        bx, by, bz = pts[b]
        cx, cy, cz = pts[c]
        total += (
            ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
        ) / 6.0
    return float(total)


def part_info(name: str, obj) -> dict:
    """逐件真值（volume/bbox/质心），保持零件树顺序（W6 比对硬约束）。

    bbox 走 `exact_bbox`（不用 `obj.BoundingBox()`）——同 `bbox_of` 的理由：
    零件与整件共享同一 `TopoDS_Shape`，整件一旦被三角化，逐件 bbox 也会被污染。
    """
    bb = exact_bbox(obj)
    c = obj.Center()
    return {
        "name": name,
        "volume": float(obj.Volume()),
        "bbox": [float(bb[3] - bb[0]), float(bb[4] - bb[1]), float(bb[5] - bb[2])],
        "bbox_min": [float(bb[0]), float(bb[1]), float(bb[2])],
        "bbox_max": [float(bb[3]), float(bb[4]), float(bb[5])],
        "center": [float(c.x), float(c.y), float(c.z)],
    }


def build_case(entry: dict, out_dir: Path) -> dict:
    """构建一个用例：实例化 → 导出 STEP → 记 manifest。"""
    import cadquery as cq  # noqa: PLC0415 — 延迟 import，让 --help 不依赖环境

    import cq_warehouse  # noqa: F401,PLC0415 — 触发包初始化
    # ⚠️ W4：`BradTeeNut.custom_make`（fastener.py:747）调 `Workplane.clearanceHole`，
    # 该方法由 extensions.py 在 **import 时** monkey-patch（extensions.py:1324）；
    # 上游 tests 同样依赖这个副作用。不加载 → `AttributeError: 'Workplane' object
    # has no attribute 'clearanceHole'`（首轮生成 BradTeeNut 时实测踩到）。
    # 平台侧不移植 extensions.py（方案 §1：4110 行 Workplane/Sketch/Assembly
    # monkey-patch，依赖 cadquery 私有结构），此处只让 A 侧参考环境完整。
    import cq_warehouse.extensions  # noqa: F401,PLC0415
    import importlib  # noqa: PLC0415

    mod = CLASS_MODULES[entry["class"]]
    cls = getattr(importlib.import_module(mod), entry["class"])
    obj = cls(**entry["args"])

    step_path = out_dir / f"{entry['id']}.step"
    # 上游对象都是 cadquery Shape（Solid/Compound）→ 统一 exportStep
    cq.exporters.export(obj, str(step_path), exportType="STEP")

    item = {
        "id": entry["id"],
        "class": entry["class"],
        "args": entry["args"],
        "volume": float(obj.Volume()),
        "bbox": bbox_of(obj),
        "shapeType": obj.ShapeType(),
        "step": step_path.name,
    }
    if "expect_volume" in entry:
        item["expect_volume"] = entry["expect_volume"]
        diff = abs(item["volume"] - entry["expect_volume"])
        item["expect_diff"] = diff
    # Compound → 逐件记录（零件顺序即遍历顺序，B 侧必须逐字照抄）
    if obj.ShapeType() == "Compound":
        item["parts"] = [
            part_info(f"part{i}", s) for i, s in enumerate(obj.Solids(), start=1)
        ]
    # ⚠️ `volume_mesh` 必须放**最后**：`tessellate()` 原地给 shape 建三角化。
    # 上面所有字段已改用与三角化无关的精确取值（`exact_bbox`），这里再兜一层顺序保证。
    item["volume_mesh"] = mesh_volume_of(obj)
    return item


def dump_data_snapshot(out_dir: Path) -> dict:
    """W1 数值快照（方案 §5.3 / W1 验收 3）：逐表逐规格逐单元格求值，
    供 TS 侧 measure/params 与 Python eval 语义逐值比对（容差 1e-12）。"""
    import csv as _csv
    import importlib

    fw = importlib.import_module("cq_warehouse.fastener")

    # CSV 与 .py 同目录（.../src/cq_warehouse/）；FAI_CQ_UPSTREAM 指 src 时下钻一级
    upstream = Path(os.environ.get("FAI_CQ_UPSTREAM", str(DEFAULT_CQ_WAREHOUSE_SRC)))
    csv_dir = upstream if (upstream / "hex_nut_parameters.csv").exists() else upstream / "cq_warehouse"
    snap: dict = {"tables": {}}
    for csv_path in sorted(csv_dir.glob("*.csv")):
        table: dict = {}
        # iso10664def 的键是 T6/T8（非 M 开头），但上游消费它是
        # evaluate_parameter_dict_of_dict 默认 is_metric=True（fastener.py:275）；
        # 按 key[0]=='M' 判会错乘 25.4。此表固定公制。
        is_metric_table = csv_path.name == "iso10664def.csv"
        with open(csv_path, encoding="utf-8", newline="") as fh:
            reader = _csv.DictReader(fh)
            fieldnames = reader.fieldnames
            for row in reader:
                key = row[fieldnames[0]]
                row.pop(fieldnames[0])
                # 上游 isolate_fastener_type（fastener.py:148）在求值前过滤空串；
                # 空串直接 eval 会 SyntaxError，必须先滤（与上游类内路径同构）
                non_empty = {k: v for k, v in row.items() if v is not None and v.strip() != ""}
                # 与上游类内路径同构：per-cell evaluate（is_metric 按键首字符）
                table[key] = fw.evaluate_parameter_dict(
                    non_empty, is_metric=is_metric_table or key[0] == "M"
                )
        snap["tables"][csv_path.name] = table

    # 上游已解析的工艺表（Python 权威结果，TS 侧 lookupDrillDiameters 等直接对齐）
    snap["resolved"] = {
        "clearance_hole_data": fw.Nut.clearance_hole_data,
        "tap_hole_data": fw.Nut.tap_hole_data,
        "drill_sizes": fw.read_drill_sizes(),
        "nominal_screw_lengths": fw.lookup_nominal_screw_lengths(),
    }
    return snap


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--set", dest="case_set", default="smoke", choices=sorted(CASE_SETS))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--ids", default=None, help="只跑指定 id（逗号分隔）")
    ap.add_argument(
        "--dump-data",
        dest="dump_data",
        action="store_true",
        help="附带逐表逐值数据快照 data-snapshot.json（W1 数值比对 A 侧）",
    )
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    upstream_src = bootstrap_sys_path()
    cases = list(CASE_SETS[args.case_set])
    if args.ids:
        wanted = set(args.ids.split(","))
        cases = [c for c in cases if c["id"] in wanted]
        missing = wanted - {c["id"] for c in cases}
        if missing:
            print(f"[gen-reference] unknown ids: {sorted(missing)}", file=sys.stderr)
            return 2

    import cadquery as cq  # noqa: PLC0415

    # 与既有 manifest 合并（按 id upsert）：新增用例不丢历史用例——
    # 与 fai_cq_gears 的 merge-reference.ts 同一条约定（一个事实一个家）
    manifest_path = out_dir / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
    else:
        manifest = {}
    merged: dict[str, dict] = {c["id"]: c for c in manifest.get("cases", [])}

    manifest.update(
        {
            "generator": "fai_cq_warehouse/scripts/gen-reference.py",
            "set": args.case_set,
            "environment": {
                "python": platform.python_version(),
                "cadquery": cq.__version__,
                "cq_warehouse_git_head": git_sha_of(Path(upstream_src)),
            },
        }
    )

    failures = 0
    for entry in cases:
        print(f"[gen-reference] building {entry['id']} ...", flush=True)
        try:
            item = build_case(entry, out_dir)
        except Exception:
            failures += 1
            traceback.print_exc()
            continue
        merged[entry["id"]] = item
        print(f"     volume={item['volume']}")
    manifest["cases"] = [merged[k] for k in sorted(merged)]

    if args.dump_data:
        snap_path = out_dir / "data-snapshot.json"
        snap_path.write_text(
            json.dumps(dump_data_snapshot(out_dir), indent=1, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"[gen-reference] data snapshot -> {snap_path}")

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(
        f"[gen-reference] done: {len(manifest['cases'])} ok, {failures} failed"
        f" -> {out_dir / 'manifest.json'}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
