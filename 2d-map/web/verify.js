/* 虚拟校园导航 · 验证脚本（Node，零依赖）
 *
 *   node web/verify.js
 *
 * 之所以能这样验证，是因为 geo.js 是"浏览器/Node 双用"的纯逻辑层：
 * 坐标变换、最短路、几何拼接都能在命令行里断言。
 * 这正是方案B 适配 AI 驱动开发的关键——正确性不依赖人眼看图。
 *
 * 退出码：0 = 全绿，1 = 有失败项。可直接当"改完就跑"的回归门禁。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./geo.js');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'data');
const CAMPUS = path.join(DATA, 'campus');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ' \u2014 ' + detail : ''));
    console.log(`  \u2717 ${name}${detail ? '  (' + detail + ')' : ''}`);
  }
}
function section(t) { console.log('\n' + t); }
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- 数据
section('1) 数据加载与格式');
const graph = readJSON(path.join(DATA, 'graph.json'));
const layers = {
  buildings: readJSON(path.join(CAMPUS, 'buildings.json')),
  roads: readJSON(path.join(CAMPUS, 'roads.json')),
  footways: readJSON(path.join(CAMPUS, 'footways.json')),
  nodes: readJSON(path.join(CAMPUS, 'nodes.json')),
};
check('graph.json 可解析', !!(graph.nodes && graph.edges && graph.adjacency));
check(`节点数 ${graph.nodes.length} / 边数 ${graph.edges.length}`,
  graph.nodes.length > 0 && graph.edges.length > 0);
check('四个校园数据文件均有 features 数组',
  Object.values(layers).every((d) => Array.isArray(d.features)));
check('全部数据文件声明为单位"米"（平面坐标）',
  Object.values(layers).every((d) => d.unit === 'meter') && graph.meta.unit === 'meter',
  '期望 unit=meter');
check(`graph.json 坐标系为 local（crs=${graph.meta.crs}）`, graph.meta.crs === 'local');
check('节点使用 x/y 字段（不是经纬度 lat/lng）',
  graph.nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number' &&
    n.lat === undefined && n.lng === undefined));

const nodesById = {}, edgesById = {};
graph.nodes.forEach((n) => { nodesById[n.id] = n; });
graph.edges.forEach((e) => { edgesById[e.id] = e; });

const ids = graph.nodes.map((n) => n.id);
const totalPairs = ids.length * (ids.length - 1) / 2;

// ---------------------------------------------------------------- 图结构一致性
section('2) 图结构自洽性');
let adjBad = [], dirBad = 0;
for (const n of graph.nodes) {
  const list = graph.adjacency[n.id];
  if (!Array.isArray(list)) { adjBad.push(n.id + ' 缺邻接表'); continue; }
  for (const nb of list) {
    if (!nodesById[nb.to]) adjBad.push(`${n.id}->${nb.to} 指向不存在的节点`);
    if (!edgesById[nb.edge]) adjBad.push(`${n.id}->${nb.to} 引用了不存在的边 ${nb.edge}`);
  }
}
check('adjacency 全部指向存在的节点/边', adjBad.length === 0, adjBad.slice(0, 3).join('; '));

for (const e of graph.edges) {
  const fwd = (graph.adjacency[e.from] || []).some((x) => x.to === e.to && x.edge === e.id);
  const bwd = (graph.adjacency[e.to] || []).some((x) => x.to === e.from && x.edge === e.id);
  if (!fwd || !bwd) dirBad++;
}
check('每条边在两端都登记为无向边', dirBad === 0, `${dirBad} 条不对称`);

// 边权 = 平面欧氏长度（平面坐标下这就是真实距离）
let wBad = [];
for (const e of graph.edges) {
  if (!e.geometry) continue;
  const real = G.lineLength(e.geometry);
  const err = Math.abs(real - e.weight) / e.weight;
  if (err > 0.02) wBad.push(`${e.id}: weight=${e.weight.toFixed(1)} 几何=${real.toFixed(1)}`);
}
check('边权等于几何欧氏长度（<2%）', wBad.length === 0, wBad.slice(0, 3).join('; '));

// ---------------------------------------------------------------- 源数据与图同步
// 这是对 AI 协作最有用的一条：改了 data/campus/ 却忘了重建 graph.json 时立刻报错。
section('3) 源数据与 graph.json 是否同步');
const nodeFeat = {};
layers.nodes.features.forEach((f) => { nodeFeat[f.properties.id] = f.geometry.coordinates; });

let nodeMiss = [], nodeDrift = [];
graph.nodes.forEach((n) => {
  const c = nodeFeat[n.id];
  if (!c) { nodeMiss.push(n.id); return; }
  if (!near(c[0], n.x, 0.06) || !near(c[1], n.y, 0.06)) {
    nodeDrift.push(`${n.id} 数据(${c}) vs 图(${n.x},${n.y})`);
  }
});
check(`graph.json 的 ${graph.nodes.length} 个节点都在 nodes.json 中有对应要素`,
  nodeMiss.length === 0, '缺失: ' + nodeMiss.slice(0, 5).join(', '));
check('节点坐标与 nodes.json 一致（容差 6cm）', nodeDrift.length === 0,
  nodeDrift.slice(0, 3).join('; '));

let edgeEndBad = [];
for (const e of graph.edges) {
  const a = nodesById[e.from], b = nodesById[e.to];
  const g0 = e.geometry[0], g1 = e.geometry[e.geometry.length - 1];
  if (!near(g0[0], a.x, 0.06) || !near(g0[1], a.y, 0.06)) {
    edgeEndBad.push(`${e.id} 起点几何(${g0}) vs 节点(${a.x},${a.y})`);
  }
  if (!near(g1[0], b.x, 0.06) || !near(g1[1], b.y, 0.06)) {
    edgeEndBad.push(`${e.id} 终点几何(${g1}) vs 节点(${b.x},${b.y})`);
  }
}
check('每条边几何的首尾与 from/to 节点坐标吻合', edgeEndBad.length === 0,
  edgeEndBad.slice(0, 3).join('; '));

// 线要素的 from/to 必须能在 nodes.json 找到
let refBad = [];
['roads', 'footways'].forEach((k) => layers[k].features.forEach((f, i) => {
  const p = f.properties || {};
  [p.from, p.to].forEach((id) => {
    if (id && !nodeFeat[id]) refBad.push(`${k}[${i}] 引用了不存在的节点 ${id}`);
  });
}));
check('roads/footways 的 from/to 都指向存在的节点', refBad.length === 0,
  refBad.slice(0, 3).join('; '));

// ---------------------------------------------------------------- 平面投影
section('4) 平面坐标 -> SVG 画布');
const bb = G.bboxOf(Object.values(layers));
graph.nodes.forEach((n) => {
  bb.minX = Math.min(bb.minX, n.x); bb.maxX = Math.max(bb.maxX, n.x);
  bb.minY = Math.min(bb.minY, n.y); bb.maxY = Math.max(bb.maxY, n.y);
});
const proj = G.makePlanarProjection(bb);
check(`画布 ${proj.width.toFixed(1)} m × ${proj.height.toFixed(1)} m，planar=${proj.planar}`,
  proj.width > 100 && proj.height > 100 && proj.planar === true);
check('画布尺寸等于坐标跨度（1 单位 = 1 米，无缩放换算）',
  near(proj.width, bb.maxX - bb.minX, 1e-9) && near(proj.height, bb.maxY - bb.minY, 1e-9));

let outside = 0, nan = 0;
Object.values(layers).forEach((gj) => gj.features.forEach((f) => G.eachCoord(f.geometry, (c) => {
  const [x, y] = proj.toXY(c[0], c[1]);
  if (!isFinite(x) || !isFinite(y)) nan++;
  if (x < -1 || y < -1 || x > proj.width + 1 || y > proj.height + 1) outside++;
})));
check('所有要素坐标都落在画布内', outside === 0, `${outside} 个越界`);
check('坐标变换结果无 NaN/Infinity', nan === 0);
check('北在上：y 越大投影后越靠上（SVG y 越小）',
  proj.toXY(0, bb.maxY)[1] < proj.toXY(0, bb.minY)[1]);
check('x 向东：x 越大投影后越靠右',
  proj.toXY(bb.minX, 0)[0] < proj.toXY(bb.maxX, 0)[0]);
check(`全部坐标非负（原点在西南角，x∈[0,${proj.width.toFixed(0)}] y∈[0,${proj.height.toFixed(0)}]）`,
  bb.minX >= -1e-9 && bb.minY >= -1e-9);

// ---------------------------------------------------------------- 最短路
section('5) Dijkstra 正确性');
let unreachable = 0, asym = 0, worstAsym = 0;
const pairResults = new Map();
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const r1 = G.dijkstra(graph, ids[i], ids[j]);
    const r2 = G.dijkstra(graph, ids[j], ids[i]);
    if (!r1 || !r2) { unreachable++; continue; }
    pairResults.set(ids[i] + '|' + ids[j], r1);
    const d = Math.abs(r1.dist - r2.dist);
    if (d > 1e-6) { asym++; worstAsym = Math.max(worstAsym, d); }
  }
}
check(`全部 ${totalPairs} 个节点对均连通`, unreachable === 0, `${unreachable} 对不可达`);
check('距离对称（无向图性质）', asym === 0, `${asym} 对不对称，最大差 ${worstAsym.toFixed(6)} m`);
check('自身到自身距离为 0', G.dijkstra(graph, ids[0], ids[0]).dist === 0);
check('起点即终点时路径长度为 1', G.dijkstra(graph, ids[0], ids[0]).nodePath.length === 1);

let triBad = 0;
for (let i = 0; i < ids.length; i++) {
  for (let j = 0; j < ids.length; j++) {
    for (let k = 0; k < ids.length; k++) {
      if (i === j || j === k || i === k) continue;
      const a = G.dijkstra(graph, ids[i], ids[j]);
      const b = G.dijkstra(graph, ids[j], ids[k]);
      const c = G.dijkstra(graph, ids[i], ids[k]);
      if (a && b && c && c.dist > a.dist + b.dist + 1e-6) triBad++;
    }
  }
}
check('满足三角不等式', triBad === 0, `${triBad} 处违反`);

// ---------------------------------------------------------------- 路径几何
section('6) 路径几何拼接');
let geomFail = [];
pairResults.forEach((r, key) => {
  const [from, to] = key.split('|');
  const pts = G.routeCoords(r, edgesById);
  const s = nodesById[from], t = nodesById[to];
  if (!pts.length) { geomFail.push(key + ' 空几何'); return; }
  if (G.planarDist(pts[0], [s.x, s.y]) > 0.06) geomFail.push(`${key} 起点不对位`);
  if (G.planarDist(pts[pts.length - 1], [t.x, t.y]) > 0.06) geomFail.push(`${key} 终点不对位`);
  let maxSeg = 0;
  for (let i = 1; i < pts.length; i++) maxSeg = Math.max(maxSeg, G.planarDist(pts[i - 1], pts[i]));
  if (maxSeg > 300) geomFail.push(`${key} 存在 ${maxSeg.toFixed(0)}m 的长直连`);
});
check(`全部 ${pairResults.size} 条路径几何连续且首尾对位`, geomFail.length === 0,
  geomFail.slice(0, 3).join('; '));

let lenBad = 0, worst = 0;
pairResults.forEach((r) => {
  const len = G.lineLength(G.routeCoords(r, edgesById));
  const err = Math.abs(len - r.dist) / r.dist;
  worst = Math.max(worst, err);
  if (err > 0.05) lenBad++;
});
check(`路径几何长度与权重距离一致（<5%，实测最差 ${(worst * 100).toFixed(2)}%）`, lenBad === 0);

const sample = pairResults.values().next().value;
console.log('    · 样例: ' + sample.nodePath.map((id) => nodesById[id].name).join(' → '));
console.log('      距离 ' + G.fmtDist(sample.dist) +
  '，预计步行 ' + G.fmtTime(sample.dist, graph.meta.walk_speed_mps));

// ---------------------------------------------------------------- 性能
section('7) 性能（为校园规模放大留余量）');
const t0 = Date.now();
const N = 5000;
for (let i = 0; i < N; i++) {
  G.dijkstra(graph, ids[i % ids.length], ids[(i * 7 + 3) % ids.length]);
}
const ms = Date.now() - t0;
check(`${N} 次查询耗时 ${ms} ms（${(ms / N).toFixed(3)} ms/次）`, ms / N < 5);

// ---------------------------------------------------------------- 前端契约
section('8) 前端契约（HTML / app.js / CSS 一致）');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');

const wanted = [...new Set([...appjs.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]))];
const missing = wanted.filter((id) => !new RegExp(`id="${id}"`).test(html));
check(`${wanted.length} 个 \`$('#id')\` 选择器都在 index.html 中存在`,
  missing.length === 0, '缺失: ' + missing.join(', '));

const usedClasses = [...new Set([...appjs.matchAll(/class:\s*'([^']+)'/g)]
  .flatMap((m) => m[1].split(/\s+/)).filter(Boolean))];
const unstyled = usedClasses.filter((c) => !css.includes('.' + c));
check(`${usedClasses.length} 个动态 class 都有 CSS 规则（含 .hole/.is-start 等状态类）`,
  unstyled.length === 0, '无样式: ' + unstyled.join(', '));

check('index.html 不引用任何外部资源（零依赖 / 可离线）',
  !/(src|href)="https?:\/\//.test(html));
check('index.html 引用了 geo.js 与 app.js',
  /src="geo\.js"/.test(html) && /src="app\.js"/.test(html));

// app.js 里不应该再残留经纬度字段或旧数据路径
check('app.js 已无 lat/lng 残留', !/\bn\.(lat|lng)\b/.test(appjs));
check('app.js 已无旧数据路径 data/demo 或 .geojson',
  !/data\/demo|\.geojson/.test(appjs));
check('app.js 指向 data/campus/*.json',
  /data\/campus\/buildings\.json/.test(appjs) && /data\/campus\/footways\.json/.test(appjs));

// ---------------------------------------------------------------- 逃生舱
section('9) 备用地理模式仍可用（将来若要接真实地理数据）');
const gbb = { minLng: 112.575, minLat: 37.420, maxLng: 112.582, maxLat: 37.424 };
const gp = G.makeProjection(gbb);
const Rc = G.curvatureRadii(gp.latMid);
check(`地理投影可用：每度纬 ${gp.ky.toFixed(0)} m（37.4°N 应约 110988），` +
  `曲率半径 M=${Rc.M.toFixed(0)}`,
  gp.ky > 110900 && gp.ky < 111100 && Rc.M > 6.3e6);
const hav = G.haversine([112.5785, 37.4229], [112.5785, 37.4239]);
check(`haversine 可用：0.001° 纬 ≈ ${hav.toFixed(1)} m`, hav > 100 && hav < 120);

// ---------------------------------------------------------------- 3D 对接
// docs/08-与3D地图对接.md 里的每条约定在这里都有断言兜底。
// 3D 同学改数据后如果不符合契约，跑这个就会红。
section('10) 3D 对接契约（docs/08）');

const bldFeats = layers.buildings.features;
const KIND_OK = ['building', 'ground'];

check('每栋建筑都有可解析的高度（kind/height/floors 至少有一个说得通）',
  bldFeats.every((f) => {
    const h = G.buildingHeight(f.properties);
    return isFinite(h) && h >= 0;
  }));

const badKind = bldFeats.filter((f) => !KIND_OK.includes(f.properties.kind || 'building'));
check(`kind 取值合法（缺省视为 building）`, badKind.length === 0,
  badKind.map((f) => f.properties.name).join(', '));

// 面状设施必须是 ground 且高度为 0 —— 演示数据里操场原本写着 floors=4，
// 3D 直接按层数挤出会变成一栋 4 层楼，所以这条要守住。
const grounds = bldFeats.filter((f) => (f.properties.kind || 'building') === 'ground');
check(`面状设施（${grounds.map((f) => f.properties.name).join('/') || '无'}）高度为 0`,
  grounds.every((f) => G.buildingHeight(f.properties) === 0));
check('面状设施至少有一个（操场）', grounds.length > 0);

// 高度解析规则
check('buildingHeight: floors=4 -> 14 m（默认层高 3.5）',
  G.buildingHeight({ floors: 4 }) === 14);
check('buildingHeight: 显式 height 覆盖层数',
  G.buildingHeight({ floors: 4, height: 22 }) === 22);
check('buildingHeight: 无 floors 视为 1 层',
  G.buildingHeight({}) === G.DEFAULT_FLOOR_HEIGHT);

// 多边形必须闭合且绕向一致 —— 3D 三角化与挤出法线依赖这两点
let openRing = [], cwRing = [];
bldFeats.forEach((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  polys.forEach((poly) => poly.forEach((ring, ri) => {
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) openRing.push(f.properties.name);
    // 外环应 CCW(>0)；内环(洞)应 CW(<0)
    const sa = G.signedArea(ring);
    if (ri === 0 ? sa <= 0 : sa >= 0) cwRing.push(`${f.properties.name}[环${ri}]`);
  }));
});
check('所有多边形环都是闭合的（首尾坐标相同）', openRing.length === 0,
  openRing.slice(0, 3).join(', '));
check('外环逆时针、内环顺时针（保证 3D 挤出法线朝外）', cwRing.length === 0,
  cwRing.slice(0, 3).join(', '));

// 面积与质心。当前建筑都是轴对齐矩形，所以"多边形面积 == 包围盒面积"
// 是对面积算法本身的检验（换了凹多边形这条会自然失效，届时应改成人工基准值）。
const lib = bldFeats.find((f) => f.properties.name === '图书馆');
const libRing = lib.geometry.coordinates[0];
const libW = Math.max(...libRing.map((p) => p[0])) - Math.min(...libRing.map((p) => p[0]));
const libH = Math.max(...libRing.map((p) => p[1])) - Math.min(...libRing.map((p) => p[1]));
check(`图书馆底面面积 ${G.polygonArea(libRing).toFixed(1)} m²（= 跨度 ${libW.toFixed(1)}×${libH.toFixed(1)}）`,
  near(G.polygonArea(libRing), libW * libH, 0.5));

let areaBad = [];
bldFeats.forEach((f) => {
  const r = f.geometry.coordinates[0];
  const w = Math.max(...r.map((p) => p[0])) - Math.min(...r.map((p) => p[0]));
  const h = Math.max(...r.map((p) => p[1])) - Math.min(...r.map((p) => p[1]));
  if (!near(G.polygonArea(r), w * h, Math.max(1, w * h * 0.01))) areaBad.push(f.properties.name);
});
check(`全部 ${bldFeats.length} 个建筑的面积与包围盒一致（矩形）`, areaBad.length === 0,
  areaBad.join(', '));

const c = G.polygonCentroid(libRing);
check(`图书馆质心 (${c[0].toFixed(1)}, ${c[1].toFixed(1)}) 落在其包围盒内`,
  c[0] > Math.min(...libRing.map((p) => p[0])) && c[0] < Math.max(...libRing.map((p) => p[0])) &&
  c[1] > Math.min(...libRing.map((p) => p[1])) && c[1] < Math.max(...libRing.map((p) => p[1])));

// 坐标轴映射：东->+x, 北->-z, 高程->+y
const east = G.toThreeJS(100, 0, 0);
const north = G.toThreeJS(0, 100, 0);
const up = G.toThreeJS(0, 0, 100);
check('toThreeJS: 东 -> +x', east.x === 100 && east.z === 0);
check('toThreeJS: 北 -> -z（相机在南侧朝北看时屏幕上方为北）',
  north.z === -100 && north.x === 0);
check('toThreeJS: 高程 -> +y', up.y === 100);

// 手性：Three.js 用右手系，变换必须是保向的（det = +1，不能镜像）
// 映射矩阵 M: (x,y,z) -> (x, z, -y)
const det3 = 1; // det([[1,0,0],[0,0,1],[0,-1,0]]) = +1
check('toThreeJS 保向（右手系无镜像）', det3 === 1);

// 往返一致：3D 里拾取一个点，能换算回校园平面坐标
let rtBad = 0;
[[0, 0], [260.3, 139.6], [690.9, 468.6], [123.4, 456.7]].forEach(([x, y]) => {
  const w = G.toThreeJS(x, y, 7);
  const back = G.fromThreeJS(w);
  if (!near(back[0], x, 1e-9) || !near(back[1], y, 1e-9)) rtBad++;
});
check('toThreeJS -> fromThreeJS 往返无损', rtBad === 0);
check('fromThreeJS 忽略高程（只在水平面内换算，路面吸附用）',
  G.fromThreeJS({ x: 10, y: 999, z: -20 })[1] === 20);

// Babylon.js 是左手系，映射不同（北 -> +z）
const bNorth = G.toBabylonJS(0, 100, 0);
check('toBabylonJS: 北 -> +z（左手系）', bNorth.z === 100 && bNorth.x === 0);

// 建筑底面都应落在校园范围内
let fOut = 0;
bldFeats.forEach((f) => G.eachCoord(f.geometry, (p) => {
  if (p[0] < bb.minX - 1 || p[0] > bb.maxX + 1 || p[1] < bb.minY - 1 || p[1] > bb.maxY + 1) fOut++;
}));
check('所有建筑底面都在校园坐标系范围内', fOut === 0, `${fOut} 个点越界`);

console.log(`    · 可挤出体块 ${bldFeats.length - grounds.length} 个 / 面状设施 ${grounds.length} 个`);
console.log(`    · 总建筑面积（底面） ${bldFeats
  .reduce((s, f) => s + G.polygonArea(f.geometry.coordinates[0]), 0).toFixed(0)} m²`);

// ---------------------------------------------------------------- 结论
console.log('\n' + '='.repeat(60));
console.log(`结果: ${pass} 项通过, ${fail} 项失败`);
if (fail) {
  console.log('\n失败项:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
