/* 方案B（纯前端 SVG 地图）—— 纯逻辑层：坐标变换 + 最短路
 *
 * 本文件刻意不含任何 DOM / Leaflet / 依赖，并且浏览器与 Node 双用：
 *   - 浏览器：<script src="geo.js">  → window.CampusGeo
 *   - Node  ：require('./geo.js')     → 同一套函数，可直接跑 verify.js 做脚本化验证
 *
 * 这是"AI 驱动开发"的关键设计：算法与渲染分离，算法可以用 node 直接断言，
 * 不需要打开浏览器、不需要截图、不需要人眼判断。
 *
 * ★ 本项目用的是**平面米坐标**（虚拟校园，无地理参照）：
 *     数据里写的就是 [x, y] 米，x 向东、y 向北，原点在校园西南角。
 *     渲染前只需 makePlanarProjection() 把 y 翻成 SVG 的向下方向。
 *   下面那套经纬度投影（makeProjection / haversine / curvatureRadii）
 *   是**备用逃生舱**：万一将来要接真实地理数据，改一行即可切换，
 *   不需要重写任何渲染或算法代码（verify.js 里有两种坐标系的一致性断言）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampusGeo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // WGS84 椭球参数
  const WGS84_A = 6378137;
  const WGS84_F = 1 / 298.257223563;
  const WGS84_E2 = WGS84_F * (2 - WGS84_F);
  const DEG = Math.PI / 180;

  /** 指定纬度处的曲率半径：M=子午圈(南北向)，N=卯酉圈(东西向) */
  function curvatureRadii(latDeg) {
    const phi = latDeg * DEG;
    const w = Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
    return { M: WGS84_A * (1 - WGS84_E2) / (w ** 3), N: WGS84_A / w };
  }

  // 参考值（赤道 / 平均），仅供对照；实际换算请用 makeProjection
  const M_PER_DEG_LAT = 110574;
  const M_PER_DEG_LNG_EQ = 111320;

  // ---------------- GeoJSON 工具 ----------------

  function eachCoord(geom, fn) {
    const c = geom && geom.coordinates;
    if (!c) return;
    switch (geom.type) {
      case 'Point': fn(c); break;
      case 'MultiPoint':
      case 'LineString': c.forEach(fn); break;
      case 'MultiLineString':
      case 'Polygon': c.forEach((ring) => ring.forEach(fn)); break;
      case 'MultiPolygon': c.forEach((p) => p.forEach((ring) => ring.forEach(fn))); break;
    }
  }

  /** 汇总若干 GeoJSON 的经纬度包围盒 */
  function bboxOf(geojsonList) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    geojsonList.forEach((gj) => {
      (gj.features || []).forEach((f) => eachCoord(f.geometry, (pt) => {
        const lng = pt[0], lat = pt[1];
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }));
    });
    return {
      minLng, minLat, maxLng, maxLat,
      // 通用别名：平面坐标模式下 minLng/minLat 实际承载的是 x/y
      minX: minLng, minY: minLat, maxX: maxLng, maxY: maxLat,
    };
  }

  /**
   * 局部等距圆柱投影：把经纬度换成**米**，得到一张比例真实、可直接当 SVG
   * viewBox 使用的平面图。校园尺度（约 1 km）下失真可忽略，也避免了 Web
   * Mercator 那套瓦片层级概念——虚拟校园本来也不需要。
   *
   * 关键是别用"每度 110540 米"这类平均常数：在 37.4°N，纬度 1° 其实是
   * 110988 m，用平均值会让南北向距离整体偏小约 0.4%。这里改用 WGS84
   * 在中心纬度处的曲率半径（M/N），把局部失真压到 0.1% 以内。
   *
   * 返回 { toXY(lng,lat) -> [x,y], width, height, kx, ky, latMid }
   * y 轴向下（SVG 约定），北在上。
   */
  function makeProjection(bbox) {
    const latMid = (bbox.minLat + bbox.maxLat) / 2;
    const R = curvatureRadii(latMid);
    const kx = R.N * Math.cos(latMid * DEG) * DEG;   // 每度经度对应的米数
    const ky = R.M * DEG;                            // 每度纬度对应的米数
    const width = (bbox.maxLng - bbox.minLng) * kx;
    const height = (bbox.maxLat - bbox.minLat) * ky;

    function toXY(lng, lat) {
      return [(lng - bbox.minLng) * kx, (bbox.maxLat - lat) * ky];
    }
    return { toXY, width, height, kx, ky, latMid, bbox };
  }

  /**
   * 平面投影：坐标本身就是**米**。
   *
   * 虚拟校园是自绘的，本来就不需要任何地理参照——直接把平面坐标写进数据
   * 即可。关键点：本函数与 makeProjection 返回**同一形状**，所以下游
   * （Dijkstra、路径拼接、SVG 渲染）一行都不用改。
   * verify.js 里用"同一份数据分别走两种坐标系、结果必须完全一致"来证明这点。
   */
  function makePlanarProjection(bbox) {
    const width = bbox.maxX - bbox.minX;
    const height = bbox.maxY - bbox.minY;
    function toXY(x, y) { return [x - bbox.minX, bbox.maxY - y]; }
    return { toXY, width, height, kx: 1, ky: 1, planar: true, bbox };
  }

  /** 两点球面距离（米），用于校验边权是否与几何一致 */
  function haversine(a, b) {
    const R = 6371008.8;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /** 平面欧氏距离（米）—— 本项目的主用度量 */
  function planarDist(a, b) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  /**
   * 折线总长（米）。
   * distFn 默认平面欧氏距离；若数据是经纬度，传 haversine 进去即可。
   */
  function lineLength(pts, distFn) {
    const d = distFn || planarDist;
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += d(pts[i - 1], pts[i]);
    return s;
  }

  // ---------------- 最小堆（Dijkstra 用） ----------------

  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(item) {
      const a = this.a;
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
      }
    }
    pop() {
      const a = this.a;
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
        }
      }
      return top;
    }
  }

  /**
   * Dijkstra 最短路。graph 形状与 data/graph.json 一致：
   *   { nodes:[{id,name,x,y}], edges:[...], adjacency: { id: [{to,weight,edge}] } }
   * 相比把邻接表重新建一遍，直接消费 adjacency 既快又不引入二义性。
   * 用二叉堆而非每轮 sort，节点数上千时也不会退化。
   */
  function dijkstra(graph, startId, endId) {
    if (startId === endId) return { nodePath: [startId], edgePath: [], dist: 0 };
    const dist = new Map([[startId, 0]]);
    const prev = new Map();          // nodeId -> { from, edgeId }
    const visited = new Set();
    const pq = new MinHeap();
    pq.push([0, startId]);

    while (pq.size) {
      const [d, u] = pq.pop();
      if (visited.has(u)) continue;
      visited.add(u);
      if (u === endId) break;
      const nbrs = graph.adjacency[u] || [];
      for (let i = 0; i < nbrs.length; i++) {
        const to = nbrs[i].to, w = nbrs[i].weight;
        const nd = d + w;
        if (nd < (dist.has(to) ? dist.get(to) : Infinity)) {
          dist.set(to, nd);
          prev.set(to, { from: u, edgeId: nbrs[i].edge });
          pq.push([nd, to]);
        }
      }
    }
    if (!visited.has(endId)) return null;

    const nodePath = [endId], edgePath = [];
    let cur = endId;
    while (cur !== startId) {
      const p = prev.get(cur);
      edgePath.unshift(p.edgeId);
      cur = p.from;
      nodePath.unshift(cur);
    }
    return { nodePath, edgePath, dist: dist.get(endId) };
  }

  /**
   * 把最短路结果拼成一条连续折线（原始坐标数组 [x,y] 或 [lng,lat]），供 SVG 直接画。
   * 边是双向存储的，所以要按行进方向判断是否反转坐标串。
   */
  function routeCoords(result, edgesById) {
    const pts = [];
    for (let i = 0; i < result.edgePath.length; i++) {
      const e = edgesById[result.edgePath[i]];
      if (!e || !e.geometry) continue;
      const forward = e.from === result.nodePath[i];
      const geom = forward ? e.geometry : e.geometry.slice().reverse();
      for (let j = 0; j < geom.length; j++) {
        const last = pts[pts.length - 1];
        if (!last || last[0] !== geom[j][0] || last[1] !== geom[j][1]) pts.push(geom[j]);
      }
    }
    return pts;
  }

  function fmtDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  }

  function fmtTime(m, speed) {
    const min = m / (speed || 1.2) / 60;
    return min < 1 ? Math.round(m / (speed || 1.2)) + ' 秒' : Math.ceil(min) + ' 分钟';
  }

  // ---------------- 多边形几何（3D 挤出要用） ----------------

  /**
   * 有向面积。>0 = 逆时针(CCW)，<0 = 顺时针(CW)。
   * 3D 挤出的法线方向依赖绕向，所以这个符号是有意义的，不是中间量。
   */
  function signedArea(ring) {
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return s / 2;
  }

  /** 多边形面积（平方米） */
  function polygonArea(ring) { return Math.abs(signedArea(ring)); }

  /** 面积加权质心（比顶点平均值正确，凹多边形/顶点疏密不均时不会偏） */
  function polygonCentroid(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      a += cross;
      cx += (ring[i][0] + ring[i + 1][0]) * cross;
      cy += (ring[i][1] + ring[i + 1][1]) * cross;
    }
    a /= 2;
    if (Math.abs(a) < 1e-12) {           // 退化多边形：退回顶点平均
      const n = Math.max(1, ring.length - 1);
      let sx = 0, sy = 0;
      for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
      return [sx / n, sy / n];
    }
    return [cx / (6 * a), cy / (6 * a)];
  }

  // ---------------- 3D 对接（契约详见 docs/08-与3D地图对接.md） ----------------

  /** 默认层高（米）。3D 里没有显式 height 时用它乘层数。 */
  const DEFAULT_FLOOR_HEIGHT = 3.5;

  /**
   * 从要素 properties 解析出 3D 体块高度（米）。
   * 优先级：显式 height > 层数 × 层高；kind="ground" 一律为 0（贴地，不挤出）。
   *
   * 为什么需要 kind：操场、广场这类"面状设施"也放在 buildings.json 里，
   * 但它们没有楼层。演示数据里操场也写着 floors=4，如果 3D 直接按层数挤出，
   * 操场会变成一栋 4 层楼——所以必须由 kind 显式区分。
   */
  function buildingHeight(props, floorHeight) {
    const p = props || {};
    if ((p.kind || 'building') === 'ground') return 0;
    if (typeof p.height === 'number' && isFinite(p.height)) return p.height;
    const f = typeof p.floors === 'number' && p.floors > 0 ? p.floors : 1;
    return f * (floorHeight || DEFAULT_FLOOR_HEIGHT);
  }

  /**
   * 校园平面坐标 -> Three.js 世界坐标（y 轴向上，右手系）。
   *   东(+x) -> three.x     北(+y) -> three.z 取负     高程 -> three.y
   * 相机放在南侧上方朝北看时，屏幕正上方就是北——与看平面图的直觉一致。
   */
  function toThreeJS(x, y, elevation) {
    return { x: x, y: elevation || 0, z: -y };
  }

  /** 校园平面坐标 -> Babylon.js 世界坐标（y 轴向上，左手系）。北 -> +z。 */
  function toBabylonJS(x, y, elevation) {
    return { x: x, y: elevation || 0, z: y };
  }

  /** 3D 世界坐标 -> 校园平面坐标（把 Three.js 里的拾取点换算回 2D 用） */
  function fromThreeJS(p) {
    return [p.x, -p.z];
  }

  return {
    // 主用（平面米坐标）
    eachCoord, bboxOf, makePlanarProjection, planarDist, lineLength,
    MinHeap, dijkstra, routeCoords, fmtDist, fmtTime,
    // 多边形几何
    signedArea, polygonArea, polygonCentroid,
    // 3D 对接（docs/08）
    DEFAULT_FLOOR_HEIGHT, buildingHeight, toThreeJS, toBabylonJS, fromThreeJS,
    // 备用逃生舱（真实地理坐标）
    makeProjection, haversine, curvatureRadii, M_PER_DEG_LAT, M_PER_DEG_LNG_EQ,
  };
});
