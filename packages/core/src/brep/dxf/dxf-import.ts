/**
 * DXF 导入（移植自 brepjs `src/io/dxfImportFns.ts`，2026-10-17）。
 *
 * 与 brepjs 相同的两个关键设计（对面 faijs-openscad 旧解析器的教训）：
 * 1. **严格两行一组配对遍历**（组码一行、值一行，游标 i += 2）——不做逐行
 *    扫描特判。DXF 组码流里任何一对（如 `999` 注释、HEADER 变量）都天然是
 *    一个 tag-value 对，配对遍历不会错位；逐行扫描遇格式细节（999 头、嵌套
 *    段）游标易漂移，导致实体漏读（faijs-openscad example013 的根因）。
 * 2. **不做端点拼线**：实体 → edge 后直接交给内核 `makeWire`
 *    （OCCT `BRepBuilderAPI_MakeWire` 按拓扑连续性自组），比 JS 侧端点
 *    容差匹配更健壮。polyline 仍在 JS 侧展开成连续 edge 序列。
 *
 * 支持实体：LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE。
 * 输出：闭合 wire 数组（调用方再 `makeFace` 面化）。
 */
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '../engine/primitives';
import { ioError, BrepErrorCode, type BrepError } from '../../result/errors';
import { ok, err, type Result } from '../../result/result';
import { makeLine2d, makeArc2dThreePoints, type Curve2dObj } from '../../geometry2d/curve2d';
import { Blueprint } from '../../geometry2d/blueprint';
import { assembleWire } from '../../geometry2d/bridge/lift-on-plane';
import { classifyNested, computeSignedArea } from '../../geometry2d/nesting';

// ─── DXF 实体模型 ───

interface DxfEntity {
  readonly type: string;
  readonly layer: string;
  /** 组码 → 值（同一组码多次出现时保留**最后一个**；polyline 顶点例外，见 DxfPolyline） */
  readonly data: Map<number, string>;
}

/** LWPOLYLINE / POLYLINE 的顶点序列（组码 10/20 成对重复出现）。 */
interface DxfPolylineVertex {
  readonly x: number;
  readonly y: number;
  /** 凸度（bulge，组码 42）：0=直线，>0 逆时针圆弧，<0 顺时针圆弧 */
  readonly bulge: number;
}

interface DxfParsed {
  readonly lines: DxfEntity[];
  readonly circles: DxfEntity[];
  readonly arcs: DxfEntity[];
  readonly polylines: DxfPolylineVertex[][];
}

// ─── 解析器 ───

/**
 * 解析 ASCII DXF 的 ENTITIES 段，把实体按类型分组。
 *
 * 结构约定（与 brepjs 一致）：
 * - 先跳到 `2 ENTITIES` 段标记；
 * - `0 <TYPE>` 开启新实体，其后组码/值对存入该实体的 data；
 * - `0 ENDSEC` / `0 EOF` 结束。
 *
 * @param text - ASCII DXF 文件全文
 * @returns 按类型分组的实体（LINE/CIRCLE/ARC 各自的组码表 + polyline 顶点序列）
 */
export function parseDxfEntities(text: string): DxfParsed {
  const lines = text.split(/\r?\n/);
  // 实体与（polyline 的）顶点序列在实体边界处配对收集——顶点不能挂共享变量
  // 在分组循环里引用：那样每条 polyline 都会拿到**最后一条**的顶点
  //（2026-10-17 实证：example「回」字形 DXF 两条 polyline 产出两个相同内圈 wire）。
  const collected: Array<{ entity: DxfEntity; vertices?: DxfPolylineVertex[] }> = [];

  let inEntities = false;
  let current: { type: string; layer: string; data: Map<number, string> } | undefined;
  // polyline 顶点的 10/20/42 组码成组重复，Map 会覆盖——单独收集。
  let polylineVertices: DxfPolylineVertex[] | undefined;
  let pendingVertex: { x?: number; y?: number; bulge: number } | undefined;

  const flushVertex = (): void => {
    if (pendingVertex && pendingVertex.x !== undefined && pendingVertex.y !== undefined) {
      polylineVertices!.push({
        x: pendingVertex.x,
        y: pendingVertex.y,
        bulge: pendingVertex.bulge,
      });
    }
    pendingVertex = undefined;
  };

  /** 把当前实体连同其顶点序列（若有）落库。 */
  const flushEntity = (): void => {
    flushVertex();
    if (current) {
      collected.push({ entity: current, vertices: polylineVertices });
    }
    polylineVertices = undefined;
  };

  for (let i = 0; i < lines.length - 1; i += 2) {
    const codeLine = lines[i];
    const valueLine = lines[i + 1];
    if (codeLine === undefined || valueLine === undefined) continue;
    const code = parseInt(codeLine.trim(), 10);
    const value = valueLine.trim();
    if (Number.isNaN(code)) continue;

    if (code === 2 && (value === 'ENTITIES' || value === 'BLOCKS') && !inEntities) {
      // BLOCKS 也要扫：dxflib 等工具常把几何放进 BLOCKS 段、ENTITIES 段只留
      // INSERT 引用（faijs-openscad example013 的实际形态）。
      inEntities = true;
      continue;
    }
    if (!inEntities) continue;

    if (code === 0) {
      if (value === 'ENDSEC' || value === 'EOF') {
        flushEntity();
        break;
      }
      flushEntity();
      current = { type: value, layer: '0', data: new Map() };
      if (value === 'LWPOLYLINE' || value === 'POLYLINE') polylineVertices = [];
      continue;
    }

    if (!current) continue;

    if (code === 8) {
      current.layer = value;
      continue;
    }

    // LWPOLYLINE 顶点组码：10(x) 20(y) 42(bulge) 重复出现
    if ((current.type === 'LWPOLYLINE' || current.type === 'POLYLINE') && (code === 10 || code === 20 || code === 42)) {
      if (code === 10) {
        flushVertex();
        pendingVertex = { x: parseFloat(value), bulge: 0 };
      } else if (code === 20 && pendingVertex) {
        pendingVertex.y = parseFloat(value);
      } else if (code === 42 && pendingVertex) {
        pendingVertex.bulge = parseFloat(value);
      }
      continue;
    }

    current.data.set(code, value);
  }

  const linesOut: DxfEntity[] = [];
  const circles: DxfEntity[] = [];
  const arcs: DxfEntity[] = [];
  const polylines: DxfPolylineVertex[][] = [];
  for (const { entity: e, vertices } of collected) {
    if (e.type === 'LINE') linesOut.push(e);
    else if (e.type === 'CIRCLE') circles.push(e);
    else if (e.type === 'ARC') arcs.push(e);
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && vertices && vertices.length > 0) {
      polylines.push(vertices);
    }
  }
  return { lines: linesOut, circles, arcs, polylines };
}

// ─── 实体 → edge ───

function getNum(data: Map<number, string>, code: number, fallback = 0): number {
  const v = data.get(code);
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function vec3(x: number, y: number, z = 0): BrepVec3 {
  return { x, y, z };
}

/**
 * 把解析出的 DXF 实体转成内核 edge / wire。
 *
 * - LINE / CIRCLE / ARC → 单 edge；
 * - LWPOLYLINE / POLYLINE → 顶点折线 + bulge 圆弧（bulge≠0 的段用三点圆弧，
 *   圆心由弦中点 + bulge 几何求出），首尾相接成一条 edge 序列。
 *
 * wire 组装交给内核 `makeWire`（拓扑连续性自组）；个别实体转 edge 失败跳过，
 * 全部失败才报错。
 *
 * @param kernel - BREP 引擎契约面（makeLineEdge/makeCircleEdge/makeCircleArc/makeWire）
 * @param parsed - `parseDxfEntities` 的解析结果（按类型分组的实体）
 * @returns 组装出的 wire 数组；一条 wire 都没组出来时 `DXF_IMPORT_FAILED`
 */
export function dxfEntitiesToWires(kernel: BrepEngineApi, parsed: DxfParsed): Result<BrepHandle[], BrepError> {
  const polylineWires: BrepHandle[] = [];
  const singleEdges: BrepHandle[] = [];

  for (const e of parsed.lines) {
    try {
      singleEdges.push(
        kernel.makeLineEdge(
          vec3(getNum(e.data, 10), getNum(e.data, 20), getNum(e.data, 30)),
          vec3(getNum(e.data, 11), getNum(e.data, 21), getNum(e.data, 31)),
        ),
      );
    } catch {
      // 个别坏实体跳过，不让一个坏 LINE 弄死整张图
    }
  }

  for (const e of parsed.circles) {
    try {
      singleEdges.push(
        kernel.makeCircleEdge(
          vec3(getNum(e.data, 10), getNum(e.data, 20), getNum(e.data, 30)),
          vec3(0, 0, 1),
          getNum(e.data, 40),
        ),
      );
    } catch {
      // 跳过
    }
  }

  for (const e of parsed.arcs) {
    try {
      const startAngle = (getNum(e.data, 50) * Math.PI) / 180;
      const endAngle = (getNum(e.data, 51) * Math.PI) / 180;
      singleEdges.push(
        kernel.makeCircleArc(
          vec3(getNum(e.data, 10), getNum(e.data, 20), getNum(e.data, 30)),
          vec3(0, 0, 1),
          getNum(e.data, 40),
          startAngle,
          endAngle,
        ),
      );
    } catch {
      // 跳过
    }
  }

  for (const vertices of parsed.polylines) {
    // polyline → Curve2dObj 序列（bulge≠0 的段是真实三点圆弧，不再退化成弦线），
    // 经 geometry2d 桥 assembleWire 在 XY 平面落成 wire——与 sketch/profile 同一管线。
    const curves: Curve2dObj[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i];
      const b = vertices[i + 1];
      if (a.bulge === 0) {
        curves.push(makeLine2d(a.x, a.y, b.x, b.y));
      } else {
        // bulge → 三点圆弧：拱点 = 弦中点沿行进方向左侧法向抬升 sagitta
        // （bulge>0 逆时针，弧凸向行进方向左侧）。|bulge|>1 时 θ>π，
        // 公式 sagitta = bulge·chord/2 依然成立。
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const chord = Math.hypot(dx, dy);
        if (chord === 0) continue;
        const sagitta = (a.bulge * chord) / 2;
        const apexX = mx + (-dy / chord) * sagitta;
        const apexY = my + (dx / chord) * sagitta;
        curves.push(makeArc2dThreePoints(a.x, a.y, apexX, apexY, b.x, b.y));
      }
    }
    if (curves.length > 0) {
      try {
        polylineWires.push(assembleWire(kernel, 'XY', new Blueprint(curves)));
      } catch {
        // 单条 polyline 组线失败跳过（内含坏段时 assembleWire 可能抛）
      }
    }
  }

  // 组线：polyline 已是成品 wire；散边合并成一组由内核自组。
  const wires: BrepHandle[] = [...polylineWires];
  if (singleEdges.length > 0) {
    try {
      wires.push(kernel.makeWire(singleEdges));
    } catch {
      // 散边不闭合时可能失败——返回已有 wire
    }
  }

  if (wires.length === 0) {
    return err(
      ioError(BrepErrorCode.DXF_IMPORT_FAILED, 'DXF entities produced no closed wires', undefined),
    );
  }
  return ok(wires);
}

/**
 * 导入 DXF 文本 → 内核 wire 数组。
 * @param kernel - BREP 引擎契约面
 * @param text   - ASCII DXF 文件全文
 * @param layer  - 可选图层过滤（组码 8）
 * @returns wire 数组；解析不出闭合 wire 时 `DXF_IMPORT_FAILED`
 */
export function importDxf(
  kernel: BrepEngineApi,
  text: string,
  layer?: string,
): Result<BrepHandle[], BrepError> {
  const parsed = parseDxfEntities(text);
  if (layer !== undefined) {
    const filtered: DxfParsed = {
      lines: parsed.lines.filter((e) => e.layer === layer),
      circles: parsed.circles.filter((e) => e.layer === layer),
      arcs: parsed.arcs.filter((e) => e.layer === layer),
      polylines: parsed.polylines,
    };
    return dxfEntitiesToWires(kernel, filtered);
  }
  return dxfEntitiesToWires(kernel, parsed);
}

/** 每个 wire 的采样点数（嵌套分类用：bbox/质心判定足够，不需高密度）。 */
const WIRE_SAMPLE_POINTS = 32;

/**
 * 从内核 wire 采样 2D 点集（XY 平面，忽略 Z）。
 *
 * 组合 `getSubShapes(wire,'edge')` + `curveParameters` + `curvePointAtParam`：
 * 每条边等参数取 `WIRE_SAMPLE_POINTS` 个点。点的环绕方向跟随边的参数方向，
 * 与 wire 拓扑序一致——分类只用绝对面积与包含关系，方向无关紧要。
 *
 * @param kernel - BREP 引擎契约面（需含 getSubShapes/curveParameters/curvePointAtParam）
 * @param wire - 待采样的闭合 wire
 * @returns 采样点列表（{x,y}，XY 平面）
 */
function sampleWirePoints(kernel: BrepEngineApi, wire: BrepHandle): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const edges = kernel.getSubShapes(wire, 'edge');
  for (const edge of edges) {
    try {
      const { first, last } = kernel.curveParameters(edge);
      for (let s = 0; s < WIRE_SAMPLE_POINTS; s++) {
        const t = first + ((last - first) * s) / WIRE_SAMPLE_POINTS;
        const p = kernel.curvePointAtParam(edge, t);
        points.push({ x: p.x, y: p.y });
      }
    } catch {
      // 坏边跳过——采样点少一组不影响整体分类
    }
  }
  return points;
}

/**
 * 导入 DXF 文本 → **外轮廓/孔洞分组**的 wire（嵌套分类经 geometry2d/nesting）。
 *
 * 相比 `importDxf`（平面 wire 列表，不区分包含关系），本函数把每条 wire 采样成
 * 点集后做 evenodd 嵌套分组，返回 `{outer, holes}`——调用方直接
 * `makeFace(outer)` + `addHolesInFace(holes)`，无需自己判断包含关系。
 * 「回」字形（外圈 + 内孔）与孔中岛（深度 2 的独立外轮廓）都被正确分组。
 *
 * @param kernel - BREP 引擎契约面
 * @param text   - ASCII DXF 文件全文
 * @param layer  - 可选图层过滤（组码 8）
 * @returns 分组结果；解析不出闭合 wire 时 `DXF_IMPORT_FAILED`
 */
export function importDxfProfiles(
  kernel: BrepEngineApi,
  text: string,
  layer?: string,
): Result<{ outer: BrepHandle; holes: BrepHandle[] }[], BrepError> {
  const wiresResult = importDxf(kernel, text, layer);
  if (!wiresResult.ok) return wiresResult;
  const wires = wiresResult.value;

  // wire → 采样点 → ClassifiableSubpath
  const subpaths = wires.map((wire) => {
    const points = sampleWirePoints(kernel, wire);
    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const p of points) {
      if (p.x < bbox.minX) bbox.minX = p.x;
      if (p.y < bbox.minY) bbox.minY = p.y;
      if (p.x > bbox.maxX) bbox.maxX = p.x;
      if (p.y > bbox.maxY) bbox.maxY = p.y;
    }
    return { wire, points, bbox, signedArea: computeSignedArea(points) };
  });

  const groups = classifyNested(subpaths);
  const profiles = groups.map((g) => ({
    outer: subpaths[g.outerIdx].wire,
    holes: g.holes.map((h) => subpaths[h].wire),
  }));
  if (profiles.length === 0) {
    return err(
      ioError(BrepErrorCode.DXF_IMPORT_FAILED, 'DXF wires classified into no profiles', undefined),
    );
  }
  return ok(profiles);
}
