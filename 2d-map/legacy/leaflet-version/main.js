/* 校园2D导航演示：加载 GeoJSON 图层 + Dijkstra 最短路径
 *
 * 数据约定（与 scripts/geojson_to_graph.py 输出一致）：
 *   graph.json = { meta, nodes:[{id,name,lat,lng}], edges:[{id,from,to,name,type,weight,geometry}], adjacency }
 * 坐标统一 WGS84 经纬度；权重单位为米。
 */
'use strict';

// ---------- 数据加载 ----------
// 优先按“服务器根=项目根”取 /data/…；若直接以 web/ 为根托管则回退 ../data/…
async function fetchFirst(paths) {
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) return await r.json();
    } catch (_) { /* 尝试下一个路径 */ }
  }
  throw new Error('无法加载数据：' + paths[0] +
    '（请用 python -m http.server 在项目根目录启动服务后访问 /web/）');
}

// ---------- Dijkstra（浏览器端） ----------
function dijkstra(graph, startId, endId) {
  const dist = new Map([[startId, 0]]);
  const prev = new Map();          // nodeId -> {from, edgeId}
  const visited = new Set();
  const pq = [[0, startId]];       // [距离, 节点id]
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === endId) break;
    for (const { to, weight, edge } of (graph.adjacency[u] || [])) {
      const nd = d + weight;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, { from: u, edgeId: edge });
        pq.push([nd, to]);
      }
    }
  }
  if (!visited.has(endId)) return null;
  const nodePath = [endId];
  const edgePath = [];
  let cur = endId;
  while (cur !== startId) {
    const p = prev.get(cur);
    edgePath.unshift(p.edgeId);
    cur = p.from;
    nodePath.unshift(cur);
  }
  return { nodePath, edgePath, dist: dist.get(endId) };
}

// ---------- 全局状态 ----------
let map, graph;
let nodesById = {}, edgesById = {};
let startId = null, endId = null;
let routeLayer = null;

const $ = (s) => document.querySelector(s);
const msg = (t, ok) => { const m = $('#msg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };

// ---------- 本地瓦片后缀探测 ----------
// Esri 影像服务的瓦片其实是 JPEG（曾有一版误存成 .png）。这里探测一次真实后缀，
// 避免后缀 / Content-Type 与实际字节不符时底图整片空白。
async function detectTileExt() {
  for (const ext of ['jpg', 'png', 'webp']) {
    try {
      const r = await fetch(`lib/tiles/satellite/14/13315/6352.${ext}`, { method: 'HEAD' });
      if (r.ok) return ext;
    } catch (_) { /* 试下一个后缀 */ }
  }
  return 'jpg';
}

// ---------- 初始化 ----------
async function init() {
  map = L.map('map', { zoomControl: true });

  const tileExt = await detectTileExt();
  const sat = L.tileLayer(`lib/tiles/satellite/{z}/{x}/{y}.${tileExt}`, {
    minZoom: 13,
    maxNativeZoom: 18,   // 本地只抓到 z18，再放大交给 Leaflet 拉伸，避免请求 404
    maxZoom: 20,
    attribution: '影像: Esri, Maxar, Earthstar Geographics（仅限校内非商业用途）',
  }).addTo(map);

  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap 贡献者',
  });

  // 无底图模式：只看矢量数据（适合接入自绘校园平面图）
  const blank = L.layerGroup();
  L.control.layers(
    { '校园卫星影像（本地）': sat, 'OpenStreetMap 底图': osm, '无底图（纯矢量）': blank },
    {}, { position: 'topright' }
  ).addTo(map);

  // 如需用自己扫描的校园平面图做底图（配合 affine_fit.py 标定）：
  // const bounds = [[西南角lat,lng], [东北角lat,lng]];
  // L.imageOverlay('campus.png', bounds).addTo(blank);

  try {
    const base = location.pathname.replace(/\/web\/[^#]*$/, '/');
    graph = await fetchFirst(['/data/graph.json', base + 'data/graph.json', '../data/graph.json']);
    const [buildings, roads, footways] = await Promise.all([
      fetchFirst(['/data/demo/buildings.geojson', base + 'data/demo/buildings.geojson', '../data/demo/buildings.geojson']),
      fetchFirst(['/data/demo/roads.geojson', base + 'data/demo/roads.geojson', '../data/demo/roads.geojson']),
      fetchFirst(['/data/demo/footways.geojson', base + 'data/demo/footways.geojson', '../data/demo/footways.geojson']),
    ]);

    graph.nodes.forEach((n) => { nodesById[n.id] = n; });
    graph.edges.forEach((e) => { edgesById[e.id] = e; });

    // 建筑/操场
    const bLayer = L.geoJSON(buildings, {
      style: (f) => (f.properties.type === '体育'
        ? { color: '#4ade80', fillColor: '#bbf7d0', fillOpacity: 0.5, weight: 1 }
        : { color: '#94a3b8', fillColor: '#cbd5e1', fillOpacity: 0.7, weight: 1 }),
      onEachFeature: (f, l) => l.bindTooltip(f.properties.name, { sticky: true }),
    }).addTo(map);

    // 机动车道
    L.geoJSON(roads, {
      style: { color: '#64748b', weight: 6, opacity: 0.9, lineCap: 'round' },
    }).addTo(map);

    // 人行步道
    L.geoJSON(footways, {
      style: { color: '#16a34a', weight: 3, dashArray: '6 6', opacity: 0.9 },
    }).addTo(map);

    // 路网节点（可点击选起终点）
    const nLayer = L.layerGroup().addTo(map);
    graph.nodes.forEach((n) => {
      const m = L.circleMarker([n.lat, n.lng], {
        radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1,
      });
      m.bindTooltip(n.name, { direction: 'top' });
      m.on('click', () => onNodeClick(n.id));
      m.addTo(nLayer);
    });

    map.fitBounds(bLayer.getBounds().pad(0.15));
    fillSelects();
    msg('数据加载完成，选择起点和终点即可规划路线', true);
  } catch (e) {
    msg(e.message);
  }

  $('#btn-route').addEventListener('click', computeRoute);
  $('#btn-clear').addEventListener('click', clearRoute);
  $('#sel-start').addEventListener('change', (e) => { startId = e.target.value || null; tryAutoRoute(); });
  $('#sel-end').addEventListener('change', (e) => { endId = e.target.value || null; tryAutoRoute(); });
}

// ---------- 起终点选择 ----------
function fillSelects() {
  const opts = '<option value="">-- 请选择 --</option>' + graph.nodes
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    .map((n) => `<option value="${n.id}">${n.name}</option>`).join('');
  $('#sel-start').innerHTML = opts;
  $('#sel-end').innerHTML = opts;
}

function onNodeClick(id) {
  if (!startId || (startId && endId)) {
    clearRoute(false);
    startId = id;
    msg('已选起点：' + nodesById[id].name + '，请选择终点');
  } else if (id !== startId) {
    endId = id;
  }
  $('#sel-start').value = startId || '';
  $('#sel-end').value = endId || '';
  if (startId && endId) computeRoute();
}

function tryAutoRoute() {
  if (startId && endId) computeRoute();
}

// ---------- 路径计算与渲染 ----------
function computeRoute() {
  if (!graph || !startId || !endId) { msg('请先选择起点和终点'); return; }
  if (startId === endId) { msg('起点和终点相同'); return; }

  const r = dijkstra(graph, startId, endId);
  if (!r) { msg('两点之间不连通，请检查路网数据'); return; }

  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.layerGroup().addTo(map);

  // 按行走方向拼接每条边的几何（从终点往回取时需反转坐标）
  const pts = [];
  for (let i = 0; i < r.edgePath.length; i++) {
    const e = edgesById[r.edgePath[i]];
    const forward = e.from === r.nodePath[i];
    const geom = forward ? e.geometry : e.geometry.slice().reverse();
    for (const [lng, lat] of geom) {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== lng || last[1] !== lat) pts.push([lat, lng]);
    }
  }
  L.polyline(pts, { color: '#f97316', weight: 5, opacity: 0.95, lineCap: 'round' })
    .bindTooltip('最短路线 ' + fmtDist(r.dist), { sticky: true })
    .addTo(routeLayer);

  const s = nodesById[startId], t = nodesById[endId];
  L.circleMarker([s.lat, s.lng], {
    radius: 8, color: '#fff', weight: 3, fillColor: '#22c55e', fillOpacity: 1,
    className: 'pulse-start',
  }).bindTooltip('起点：' + s.name).addTo(routeLayer);
  L.circleMarker([t.lat, t.lng], {
    radius: 8, color: '#fff', weight: 3, fillColor: '#ef4444', fillOpacity: 1,
    className: 'pulse-end',
  }).bindTooltip('终点：' + t.name).addTo(routeLayer);

  map.fitBounds(L.latLngBounds(pts).pad(0.25));

  // 结果面板
  const speed = graph.meta.walk_speed_mps || 1.2;
  $('#r-dist').textContent = fmtDist(r.dist);
  $('#r-time').textContent = Math.ceil(r.dist / speed / 60) + ' 分钟';
  $('#r-nodes').textContent = r.nodePath.length + ' 个';
  $('#r-seq').innerHTML = r.nodePath
    .map((id) => '<li>' + nodesById[id].name + '</li>').join('');
  $('#result').classList.remove('hidden');
  msg('规划完成', true);
}

function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

function clearRoute(resetSelects = true) {
  startId = null; endId = null;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (resetSelects) { $('#sel-start').value = ''; $('#sel-end').value = ''; }
  $('#result').classList.add('hidden');
  msg('');
}

init();
