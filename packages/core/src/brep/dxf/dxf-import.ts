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
  const entities: DxfEntity[] = [];

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

  for (let i = 0; i < lines.length - 1; i += 2) {
    const codeLine = lines[i];
    const valueLine = lines[i + 1];
    if (codeLine === undefined || valueLine === undefined) continue;
    const code = parseInt(codeLine.trim(), 10);
    const value = valueLine.trim();
    if (Number.isNaN(code)) continue;

    if (code === 2 && value === 'ENTITIES' && !inEntities) {
      inEntities = true;
      continue;
    }
    if (!inEntities) continue;

    if (code === 0) {
      if (value === 'ENDSEC' || value === 'EOF') {
        flushVertex();
        if (current) entities.push(current);
        break;
      }
      flushVertex();
      if (current) entities.push(current);
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
  for (const e of entities) {
    if (e.type === 'LINE') linesOut.push(e);
    else if (e.type === 'CIRCLE') circles.push(e);
    else if (e.type === 'ARC') arcs.push(e);
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && polylineVertices && polylineVertices.length > 0) {
      polylines.push(polylineVertices);
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
  const edgeGroups: BrepHandle[][] = [];
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
    const group: BrepHandle[] = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i];
      const b = vertices[i + 1];
      try {
        if (a.bulge === 0) {
          group.push(kernel.makeLineEdge(vec3(a.x, a.y), vec3(b.x, b.y)));
        } else {
          // TODO(dxf): bulge 圆弧需要三点圆弧入口（brepjs 经 2D Curve2D 处理）。
          // BrepEngineApi 暂无该入口，bulge≠0 的段退化为弦线——轮廓闭合性
          // 不受影响，弧段精度损失留待内核补 `makeArc3Point` 后对齐 brepjs。
          group.push(kernel.makeLineEdge(vec3(a.x, a.y), vec3(b.x, b.y)));
        }
      } catch {
        // 跳过坏段
      }
    }
    if (group.length > 0) edgeGroups.push(group);
  }

  // 组线：polyline 逐组 makeWire；散边合并成一组由内核自组。
  const wires: BrepHandle[] = [];
  for (const group of edgeGroups) {
    try {
      wires.push(kernel.makeWire(group));
    } catch {
      // 组线失败的组跳过
    }
  }
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
