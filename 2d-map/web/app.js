/* 方案B（纯前端 SVG 地图）—— 渲染与交互层 · 虚拟校园主入口
 *
 * 数据源：data/graph.json（路网图）+ data/campus/{buildings,roads,footways}.json
 *
 * 三个核心特征：
 *   1. 地图要素是**真实 DOM 节点**：可以 CSS 选择、可以 addEventListener、
 *      可以在 devtools 里直接改，也能被 AI 用读文件 / grep 的方式理解；
 *   2. 每个要素带 data-* 语义属性（data-id / data-name / data-type），
 *      人和 AI 都能按语义检索，不必反推渲染顺序；
 *   3. 零依赖：没有 Leaflet、没有瓦片、没有 CDN，整站都是纯文本。
 *
 * 坐标系 = 校园**平面米坐标**（虚拟校园，无地理参照），
 * 直接当 SVG viewBox 单位（1 单位 = 1 米）。缩放/平移就是改 viewBox，
 * 不需要任何地图库，也不需要投影仪/控制点/GIS。
 */
'use strict';

(function () {
  const G = window.CampusGeo;
  const NS = 'http://www.w3.org/2000/svg';

  const $ = (s) => document.querySelector(s);
  const msg = (t, ok) => {
    const m = $('#msg');
    m.textContent = t || '';
    m.className = 'msg' + (ok ? ' ok' : '');
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ---------------- 状态 ----------------
  let graph = null;
  let proj = null;
  let view = { x: 0, y: 0, w: 1, h: 1 };
  let fitW = 1;                       // 全景时的 viewBox 宽度，用于标注反向缩放
  const nodesById = {};
  const edgesById = {};
  const nodeEls = new Map();
  let startId = null, endId = null;
  let suppressClick = false;

  let svg, layers = {};
  let routeGroup = null;              // 当前路线图层（重算时整体替换）

  // ---------------- 视图（viewBox） ----------------
  function setView(x, y, w, h) {
    view = { x, y, w, h };
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    // 标注字号反向缩放：屏幕上的字始终一样大，不会一放大就糊满屏
    svg.style.setProperty('--s', (w / fitW).toFixed(4));
  }

  function fitAll() {
    const box = svg.getBoundingClientRect();
    const cw = box.width || 900, ch = box.height || 600;
    const aspect = cw / ch;
    const m = 0.02;                                   // 2% 边距
    let w = proj.width * (1 + 2 * m);
    let h = proj.height * (1 + 2 * m);
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    fitW = w;
    setView(proj.width / 2 - w / 2, proj.height / 2 - h / 2, w, h);
  }

  /** 屏幕坐标 → SVG 用户坐标（交给浏览器算矩阵，避免手写换算出错） */
  function clientToSvg(evt) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }

  // ---------------- 数据加载 ----------------
  async function fetchFirst(paths) {
    for (const p of paths) {
      try {
        const r = await fetch(p);
        if (r.ok) return await r.json();
      } catch (_) { /* 试下一个 */ }
    }
    throw new Error('无法加载数据：' + paths[0] +
      '（请在项目根目录启动服务后访问 /web/）');
  }

  async function loadData() {
    graph = await fetchFirst(['../data/graph.json', '/data/graph.json']);
    const gj = await Promise.all([
      fetchFirst(['../data/campus/buildings.json', '/data/campus/buildings.json']),
      fetchFirst(['../data/campus/roads.json', '/data/campus/roads.json']),
      fetchFirst(['../data/campus/footways.json', '/data/campus/footways.json']),
    ]);
    graph.nodes.forEach((n) => { nodesById[n.id] = n; });
    graph.edges.forEach((e) => { edgesById[e.id] = e; });
    return { buildings: gj[0], roads: gj[1], footways: gj[2] };
  }

  // ---------------- 渲染 ----------------
  const pts2str = (pts) => pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');

  /** 校园平面坐标 [x,y]（米，y 向北）-> SVG 用户坐标（y 向下） */
  function ringXY(ring) {
    return ring.map((c) => proj.toXY(c[0], c[1]));
  }

  function centroidXY(ring) {
    let x = 0, y = 0;
    ring.forEach((c) => { const p = proj.toXY(c[0], c[1]); x += p[0]; y += p[1]; });
    return [x / ring.length, y / ring.length];
  }

  /** 统一把 Polygon / MultiPolygon 拆成 ring 数组的数组 */
  function polysOf(geom) {
    return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  }

  function renderBasemap(data) {
    // ---- 建筑面 ----
    data.buildings.features.forEach((f, i) => {
      const id = 'bld' + i;
      let firstCentroid = null;
      polysOf(f.geometry).forEach((poly) => {
        poly.forEach((ring, ri) => {
          el('polygon', {
            points: pts2str(ringXY(ring)),
            class: 'building' + (ri > 0 ? ' hole' : ''),
            'data-id': id,
            'data-name': f.properties.name,
            'data-type': f.properties.type,
            'data-kind': f.properties.kind || 'building',
            'data-floors': f.properties.floors,
            'data-height': G.buildingHeight(f.properties),
          }, layers.buildings);
        });
        if (!firstCentroid) firstCentroid = centroidXY(poly[0]);
      });
      if (firstCentroid) {
        el('text', {
          x: firstCentroid[0].toFixed(1), y: firstCentroid[1].toFixed(1),
          class: 'bld-label', 'data-for': id,
        }, layers.labels).textContent = f.properties.name;
      }
    });

    // ---- 机动车道 ----
    data.roads.features.forEach((f, i) => {
      el('polyline', {
        points: pts2str(ringXY(f.geometry.coordinates)),
        class: 'road', 'data-id': 'road' + i,
        'data-name': f.properties.name, 'data-type': 'road',
      }, layers.roads);
    });

    // ---- 人行步道 ----
    data.footways.features.forEach((f, i) => {
      el('polyline', {
        points: pts2str(ringXY(f.geometry.coordinates)),
        class: 'footway', 'data-id': 'fw' + i,
        'data-name': f.properties.name, 'data-type': 'footway',
        'data-from': f.properties.from, 'data-to': f.properties.to,
      }, layers.footways);
    });

    // ---- 路网节点 ----
    graph.nodes.forEach((n) => {
      const [x, y] = proj.toXY(n.x, n.y);
      const g = el('g', { class: 'node', 'data-id': n.id, 'data-name': n.name }, layers.nodes);
      el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 7 }, g);
      el('title', {}, g).textContent = n.name;          // 原生悬浮提示
      const t = el('text', { x: x.toFixed(1), y: (y - 11).toFixed(1), class: 'node-label' }, g);
      t.textContent = n.name;
      nodeEls.set(n.id, { g, circle: g.firstChild });
    });
  }

  // ---------------- 交互：缩放 / 平移 ----------------
  function bindNavigation() {
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [mx, my] = clientToSvg(e);
      const k = Math.exp(e.deltaY * 0.0012);                  // >1 缩小
      const w = Math.min(Math.max(view.w * k, proj.width * 0.02), proj.width * 8);
      const s = w / view.w;
      setView(mx - (mx - view.x) * s, my - (my - view.y) * s, w, view.h * s);
    }, { passive: false });

    // 注意：这里刻意**不用** setPointerCapture——捕获会把 pointerup 重定向到 <svg>，
    // 于是 click 的目标退化成 svg 本身，节点就点不中了。改用 window 上的临时监听。
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      const box = svg.getBoundingClientRect();
      const k = view.w / (box.width || 1);
      const dx = (e.clientX - drag.cx) * k;
      const dy = (e.clientY - drag.cy) * k;
      if (Math.abs(e.clientX - drag.cx) + Math.abs(e.clientY - drag.cy) > 4) drag.moved = true;
      if (drag.moved) setView(drag.vx - dx, drag.vy - dy, view.w, view.h);
    };
    const onUp = () => {
      suppressClick = !!(drag && drag.moved);
      drag = null;
      svg.classList.remove('grabbing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y, moved: false };
      svg.classList.add('grabbing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // ---------------- 交互：选点与路径 ----------------
  function bindSelection() {
    layers.nodes.addEventListener('click', (e) => {
      if (suppressClick) return;
      const g = e.target.closest ? e.target.closest('.node') : null;
      if (g) onNodeClick(g.getAttribute('data-id'));
    });
  }

  function paintNodes() {
    nodeEls.forEach(({ g }, id) => {
      g.classList.toggle('is-start', id === startId);
      g.classList.toggle('is-end', id === endId);
    });
  }

  function onNodeClick(id) {
    if (!startId || (startId && endId)) {
      clearRoute(false);
      startId = id;
      msg('已选起点：' + nodesById[id].name + '，请选择终点');
    } else if (id !== startId) {
      endId = id;
    }
    paintNodes();
    $('#sel-start').value = startId || '';
    $('#sel-end').value = endId || '';
    if (startId && endId) computeRoute();
  }

  function fillSelects() {
    const opts = '<option value="">-- 请选择 --</option>' + graph.nodes
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      .map((n) => `<option value="${n.id}">${n.name}</option>`).join('');
    $('#sel-start').innerHTML = opts;
    $('#sel-end').innerHTML = opts;
  }

  function clearRoute(resetSelects) {
    startId = null; endId = null;
    if (routeGroup) { routeGroup.remove(); routeGroup = null; }
    if (resetSelects !== false) {
      $('#sel-start').value = '';
      $('#sel-end').value = '';
    }
    $('#result').classList.add('hidden');
    paintNodes();
  }

  function computeRoute() {
    if (!graph || !startId || !endId) { msg('请先选择起点和终点'); return; }
    if (startId === endId) { msg('起点和终点相同'); return; }

    const r = G.dijkstra(graph, startId, endId);
    if (!r) { msg('两点之间不连通，请检查路网数据'); return; }

    if (routeGroup) routeGroup.remove();
    // data-* 直接记录距离与节点序列：脚本/AI 不必读像素就能核对结果
    routeGroup = el('g', {
      class: 'route', 'data-from': startId, 'data-to': endId,
      'data-distance-m': r.dist.toFixed(1),
      'data-nodes': r.nodePath.join('>'),
    }, layers.route);

    const xy = G.routeCoords(r, edgesById).map((c) => proj.toXY(c[0], c[1]));
    el('polyline', { points: pts2str(xy), class: 'route-line' }, routeGroup);

    [[startId, 'start'], [endId, 'end']].forEach(([id, kind]) => {
      const [x, y] = proj.toXY(nodesById[id].x, nodesById[id].y);
      el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 9, class: 'route-pin ' + kind }, routeGroup);
    });

    const speed = graph.meta.walk_speed_mps || 1.2;
    $('#r-dist').textContent = G.fmtDist(r.dist);
    $('#r-time').textContent = G.fmtTime(r.dist, speed);
    $('#r-nodes').textContent = r.nodePath.length + ' 个';
    $('#r-seq').innerHTML = r.nodePath
      .map((id) => '<li>' + nodesById[id].name + '</li>').join('');
    $('#result').classList.remove('hidden');
    msg('规划完成', true);
  }

  // ---------------- 启动 ----------------
  async function main() {
    svg = $('#map');
    layers = {
      buildings: $('#l-buildings'),
      roads: $('#l-roads'),
      footways: $('#l-footways'),
      route: $('#l-route'),
      nodes: $('#l-nodes'),
      labels: $('#l-labels'),
    };

    try {
      const data = await loadData();

      // 包围盒 = 全部矢量要素 ∪ 全部节点的并集（保证不裁掉任何数据）
      const bb = G.bboxOf([data.buildings, data.roads, data.footways]);
      graph.nodes.forEach((n) => {
        if (n.x < bb.minX) bb.minX = n.x;
        if (n.x > bb.maxX) bb.maxX = n.x;
        if (n.y < bb.minY) bb.minY = n.y;
        if (n.y > bb.maxY) bb.maxY = n.y;
      });
      // 平面米坐标 -> SVG 用户坐标：这一步就是全部"投影"，没有任何地理换算
      proj = G.makePlanarProjection(bb);

      renderBasemap(data);
      fitAll();
      bindNavigation();
      bindSelection();
      fillSelects();
      paintNodes();

      // 暴露给浏览器控制台 / 自动化脚本
      window.__campus = { graph, proj, view, dijkstra: G.dijkstra, version: 'planar-1' };
      msg('数据加载完成（平面米坐标 · 纯 SVG · 零依赖）', true);
    } catch (e) {
      msg(e.message);
      return;
    }

    $('#btn-route').addEventListener('click', computeRoute);
    $('#btn-clear').addEventListener('click', () => { clearRoute(true); msg(''); });
    $('#btn-fit').addEventListener('click', fitAll);
    $('#sel-start').addEventListener('change', (e) => {
      startId = e.target.value || null; paintNodes();
      if (startId && endId) computeRoute();
    });
    $('#sel-end').addEventListener('change', (e) => {
      endId = e.target.value || null; paintNodes();
      if (startId && endId) computeRoute();
    });
    window.addEventListener('resize', () => { if (proj) fitAll(); });
  }

  main();
})();
