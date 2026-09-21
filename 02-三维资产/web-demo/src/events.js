/**
 * events.js —— 信息事件系统 + AI 判断流程模拟
 * ---------------------------------------------------------------
 * 演示闭环：学生上报 → AI 判断（语义/分类/去重/可信度）→ 地图打点 → 他人可见
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------
   1. 事件类型定义
------------------------------------------------------------------ */
export const EVENT_TYPES = [
  { key: 'safety',  label: '安全预警', color: 0xff4d6d, icon: '⚠' },
  { key: 'traffic', label: '通行拥堵', color: 0xffb020, icon: '⇄' },
  { key: 'service', label: '生活服务', color: 0x2ee6a8, icon: '☕' },
  { key: 'notice',  label: '校园通知', color: 0x4dabff, icon: '◆' },
  { key: 'help',    label: '互助求助', color: 0xb07dff, icon: '✚' },
];

export const typeOf = (key) => EVENT_TYPES.find((t) => t.key === key) || EVENT_TYPES[3];

/* ------------------------------------------------------------------
   2. 上报模板（模拟真实学生语言）
------------------------------------------------------------------ */
export const TEMPLATES = {
  traffic: [
    '操场东侧这条路堵死了，刚下课人流太大，骑车根本过不去',
    '三食堂门口排队排到马路上了，队伍占了一半车道',
    '图书馆西侧路口两车剐蹭，暂时只能单边通行',
    '体育馆南门在施工，围挡占道，建议绕行教学楼那边',
  ],
  safety: [
    '实验楼后面的路灯坏了两盏，晚上那块特别黑，女生别单独走',
    '宿舍楼下电动车充电线乱拉，看着挺危险的',
    '操场西南角地面有块地砖翘起来了，刚才有人差点绊倒',
    '湖边护栏有一处松动，靠近水那边要小心',
  ],
  service: [
    '第一食堂二楼的麻辣香锅今天开窗口了，人不多',
    '图书馆三楼自习区现在空位挺多，想安静学习的可以来',
    '浴室今天热水很足，不用排队，速来',
    '快递驿站积压件清完了，取件不用等',
  ],
  notice: [
    '教务处通知：下周三下午全校停电检修，实验室提前保存数据',
    '体育场本周六有校运动会彩排，下午场地不对外开放',
    '图书馆国庆期间开馆时间调整为 9:00-17:00',
    '校医院本周开展免费体检，需提前在系统预约',
  ],
  help: [
    '有没有人捡到一张校园卡，姓名缩写 LXY，捡到请联系我',
    '求组队参加下周的算法比赛，还差一个会前端的',
    '有人在教学楼B 302 看到我的黑色雨伞吗',
    '拼车去高铁站，周五下午四点出发，还差两个人',
  ],
};

/* ------------------------------------------------------------------
   3. 标签精灵（用 Canvas 画文字贴在 3D 空间里）
------------------------------------------------------------------ */
function makeLabelSprite(text, colorHex) {
  const pad = 16;
  const fontSize = 30;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const w = ctx.measureText(text).width;

  c.width = Math.ceil(w + pad * 2);
  c.height = fontSize + pad * 1.4;

  const ctx2 = c.getContext('2d');
  ctx2.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx2.textBaseline = 'middle';

  // 背板
  const r = c.height / 2;
  ctx2.fillStyle = 'rgba(6,12,22,0.88)';
  ctx2.strokeStyle = colorHex;
  ctx2.lineWidth = 3;
  ctx2.beginPath();
  ctx2.roundRect(1.5, 1.5, c.width - 3, c.height - 3, r);
  ctx2.fill();
  ctx2.stroke();

  ctx2.fillStyle = colorHex;
  ctx2.fillText(text, pad, c.height / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  // 标签作为「地图注记」始终可见，但尺寸要收敛，避免近景时压住建筑
  const scale = 0.052;
  sprite.scale.set(c.width * scale, c.height * scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/* ------------------------------------------------------------------
   4. 标记（光柱 + 脉冲环 + 标签）
------------------------------------------------------------------ */
export function createMarker(ev, groundY = 0.2) {
  const type = typeOf(ev.type);
  const hex = '#' + type.color.toString(16).padStart(6, '0');
  const g = new THREE.Group();
  g.position.set(ev.x, groundY, ev.z);

  // —— 光柱（叠加混合会叠正反面，透明度要压得比直觉更低）
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 2.4, 34, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: type.color, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  beam.position.y = 17;
  g.add(beam);

  // —— 地面脉冲环 ×2
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.7, 40),
      new THREE.MeshBasicMaterial({
        color: type.color, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.userData.phase = i * 0.5;
    g.add(ring);
    rings.push(ring);
  }

  // —— 核心光点
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 16, 16),
    new THREE.MeshBasicMaterial({ color: type.color })
  );
  core.position.y = 3.2;
  g.add(core);

  // —— 标签
  const label = makeLabelSprite(`${type.icon} ${type.label}`, hex);
  label.position.y = 34;
  g.add(label);

  // —— 拾取用透明碰撞体
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 40, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.y = 20;
  hit.userData.eventId = ev.id;
  g.add(hit);

  g.userData = { eventId: ev.id, rings, beam, core, label, type };

  g.userData.update = (t, selected) => {
    rings.forEach((r, i) => {
      const p = ((t * 0.55 + r.userData.phase) % 1);
      const s = 1 + p * 3.4;
      r.scale.set(s, s, 1);
      r.material.opacity = (1 - p) * (selected ? 0.95 : 0.6);
    });
    core.scale.setScalar(1 + Math.sin(t * 3 + ev.x) * 0.14);
    beam.material.opacity = (selected ? 0.26 : 0.13) + Math.sin(t * 2) * 0.03;
    label.position.y = 34 + Math.sin(t * 1.5 + ev.z * 0.1) * 1.2;
  };

  return g;
}

/* ------------------------------------------------------------------
   5. AI 判断流程（模拟）
------------------------------------------------------------------ */
export const AI_STEPS = [
  { key: 'parse',  label: '语义解析', desc: '提取地点、事件、紧急度' },
  { key: 'class',  label: '分类打标', desc: '归入校园事件类型体系' },
  { key: 'dedupe', label: '去重比对', desc: '与近 30 分钟同类上报做时空比对' },
  { key: 'trust',  label: '可信度评分', desc: '结合上报人数与官方源交叉验证' },
  { key: 'pub',    label: '发布上线', desc: '写入实时信息流并推送周边学生' },
];

/** 生成一次 AI 判断结果 */
export function runAIPipeline(ev, existing) {
  const sameType = existing.filter((e) => e.type === ev.type && e.status === 'published');
  // 空间邻近（80 单位内）视为疑似重复
  const near = sameType.find((e) => Math.hypot(e.x - ev.x, e.z - ev.z) < 80);

  let credibility = 0.62 + Math.random() * 0.33;
  if (ev.official) credibility = Math.min(0.99, credibility + 0.18);
  if (near) credibility = Math.min(0.99, credibility + 0.05);

  return {
    category: ev.type,
    confidence: 0.86 + Math.random() * 0.13,
    duplicateOf: near ? near.id : null,
    credibility,
    reach: Math.round(180 + Math.random() * 2400),
    latency: 0.4 + Math.random() * 0.9,
    reason: ev.official
      ? '来源为官方渠道，直接采信并做结构化改写'
      : near
        ? `与已有上报时空邻近，判定为同一事件，合并计数`
        : '首次出现，标记为待观察',
  };
}

/* ------------------------------------------------------------------
   6. 事件工厂
------------------------------------------------------------------ */
let SEQ = 0;

export function makeEvent({ type, x, z, text, reporter, official = false, place }) {
  return {
    id: `EV${String(++SEQ).padStart(4, '0')}`,
    type,
    x,
    z,
    text,
    reporter: reporter || `同学${1000 + Math.floor(Math.random() * 9000)}`,
    official,
    place: place || '校园内',
    ts: Date.now(),
    status: 'pending',
    ai: null,
  };
}

/** 从模板随机造一条事件 */
export function randomEvent(anchors, official = false) {
  const keys = official ? ['notice'] : Object.keys(TEMPLATES);
  const type = keys[Math.floor(Math.random() * keys.length)];
  const list = TEMPLATES[type];
  const text = list[Math.floor(Math.random() * list.length)];

  const a = anchors[Math.floor(Math.random() * anchors.length)];
  // 在锚点附近做随机偏移，避免标记重叠
  const ang = Math.random() * Math.PI * 2;
  const dist = 14 + Math.random() * 34;
  const x = a.x + Math.cos(ang) * dist;
  const z = a.z + Math.sin(ang) * dist;

  return makeEvent({
    type, x, z, text, official,
    place: a.name,
    reporter: official ? '官方渠道' : undefined,
  });
}

/** 官方来源的模板文案（模拟官网/公众号抓取） */
export const OFFICIAL_TEMPLATES = TEMPLATES.notice;
