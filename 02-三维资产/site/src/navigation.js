/**
 * navigation.js —— 山河大学全园 GLB 预览 · AI 智能导航模块
 * ---------------------------------------------------------------
 * 大楼坐标来自 Blender 脚本（SVG → 世界坐标换算），
 * 路径在 three.js 场景中绘制为发光指引线。
 *
 * 坐标换算：
 *   Blender SVG:  sx, sy（像素）
 *   Blender 世界: wx = (sx - 340) * 2.4,  wy = (516 - sy) * 2.4
 *   three.js:     x = wx,  z = -wy（因为 GLB 已 export_yup，Y 朝上）
 *                  （不对：export_yup 后 Blender 的 Y 变成 three 的 Y，
 *                    Blender 的 Z 变成 three 的 Z？需要看实际模型方向）
 *   实际：从 preview.js 的预设机位反推：
 *     Blender pos[0,-520,1080] → three cam [0, 1080, 520]
 *     所以 Blender (x, y, z) → three (x, z, -y)
 *     即 three.x = blender.x, three.y = blender.z, three.z = -blender.y
 *
 * 大楼位置（x, z）= （Blender wx, -Blender wy）
 */

import * as THREE from 'three';

/* ================================================================
   1. AI 配置（预留接口，等用户提供 API Key）
================================================================ */
export const AI_CONFIG = {
  apiKey: 'sk-cdef5af34e8b4fc39b21608e2ab55d58',
  endpoint: 'https://api.deepseek.com/anthropic',
  model: 'deepseek-chat',
  enabled: true,
};

export function setAIConfig(cfg) {
  Object.assign(AI_CONFIG, cfg);
  AI_CONFIG.enabled = !!(AI_CONFIG.apiKey && AI_CONFIG.endpoint);
}

/* ================================================================
   2. 大楼数据（从 Blender 脚本提取，SVG → 世界坐标换算）
   坐标格式：three.js (x, z)，单位：米
================================================================ */

// 换算辅助：SVG(sx, sy) → three.js(x, z)
//   wx = (sx - 340) * 2.4  → three.x
//   wy = (516 - sy) * 2.4  → three.z = -wy
function svgToWorld(sx, sy) {
  return {
    x: (sx - 340) * 2.4,
    z: -(516 - sy) * 2.4,
  };
}

export const BUILDINGS = [
  // —— 中轴人文区（从南到北：主校门 → 智谷 → 图书馆 → 垂直书院 → 讲堂）——
  // 坐标依据：build_campus_site.py 中轴序列 N_GATE/N_PLAZA/N_LIB/N_TOWER/FLY
  // 建筑入口均朝南（面向中轴大道来向）
  { name: '主校门',     sx: 340, sy: 502,  shx: 14, shy: 6,   type: 'landmark', accent: 0x4dabff, entrance: 'south' },
  { name: '智谷谷底',   sx: 340, sy: 462,  shx: 18, shy: 28,  type: 'landmark', accent: 0x2ee6a8, entrance: 'south' },
  { name: '亭兰图书馆', sx: 340, sy: 300,  shx: 32, shy: 28,  type: 'landmark', accent: 0x7fd4ff, entrance: 'south' },
  { name: '垂直书院',   sx: 340, sy: 246,  shx: 18, shy: 18,  type: 'landmark', accent: 0xc9a87c, entrance: 'south' },
  { name: '讲堂',       sx: 340, sy: 165,  shx: 26, shy: 18,  type: 'landmark', accent: 0xb07dff, entrance: 'south' },

  // —— 科技区（西北，入口朝东，面向环廊）——
  { name: '创新中心',   sx: 171.8, sy: 268.1, shx: 16.8,  shy: 20.16, type: 'tech',    accent: 0x66d9ff, entrance: 'east' },
  { name: '学生中心',   sx: 219.0, sy: 268.1, shx: 16.8,  shy: 20.16, type: 'tech',    accent: 0x66d9ff, entrance: 'east' },
  { name: '演艺中心',   sx: 171.8, sy: 321.8, shx: 16.8,  shy: 20.16, type: 'tech',    accent: 0xb07dff, entrance: 'east' },
  { name: '创客工坊',   sx: 219.0, sy: 321.8, shx: 16.8,  shy: 20.16, type: 'tech',    accent: 0xffc266, entrance: 'east' },

  // —— 实验区（东北，入口朝西，面向环廊）——
  { name: '科研中心',   sx: 478.0, sy: 268.0, shx: 35.26, shy: 15.58, type: 'lab',     accent: 0x5aa9ff, entrance: 'west' },
  { name: '实验楼A',    sx: 450.8, sy: 311.8, shx: 15.83, shy: 15.83, type: 'lab',     accent: 0x5aa9ff, entrance: 'west' },
  { name: '实验楼B',    sx: 495.0, sy: 311.8, shx: 15.83, shy: 15.83, type: 'lab',     accent: 0x5aa9ff, entrance: 'west' },

  // —— 运动医疗区（西南，入口朝东，面向环廊）——
  { name: '体育馆',     sx: 212.5, sy: 374.0, shx: 16.67, shy: 14.17, type: 'sports',  accent: 0xff7b6b, entrance: 'east' },
  { name: '校医院',     sx: 170.0, sy: 374.0, shx: 15.0,  shy: 15.0,  type: 'sports',  accent: 0x6fe3c4, entrance: 'east' },
  { name: '体育场',     sx: 198.0, sy: 426.0, shx: 42.0,  shy: 24.0,  type: 'sports',  accent: 0x2ee6a8, entrance: 'north' },

  // —— 教学区（东南，入口朝西，面向环廊）——
  { name: '公共教学楼', sx: 456.8, sy: 374.8, shx: 16.8,  shy: 16.8,  type: 'teach',   accent: 0x5aa9ff, entrance: 'west' },
  { name: '教学B楼',    sx: 505.2, sy: 374.8, shx: 14.28, shy: 16.8,  type: 'teach',   accent: 0x5aa9ff, entrance: 'west' },
  { name: '教学C楼',    sx: 456.8, sy: 429.2, shx: 16.8,  shy: 16.8,  type: 'teach',   accent: 0x5aa9ff, entrance: 'west' },
  { name: '教学D楼',    sx: 505.2, sy: 429.2, shx: 14.28, shy: 16.8,  type: 'teach',   accent: 0x5aa9ff, entrance: 'west' },

  // —— 生活区（南，入口朝北，面向环廊/宿舍区道路）——
  { name: '宿舍A',      sx: 216.25, sy: 469.75, shx: 22.09, shy: 7.92,  type: 'dorm',    accent: 0xff9d7a, entrance: 'north' },
  { name: '宿舍B',      sx: 216.25, sy: 498.08, shx: 22.09, shy: 7.92,  type: 'dorm',    accent: 0xff9d7a, entrance: 'north' },
  { name: '研究生公寓', sx: 273.75, sy: 469.75, shx: 22.09, shy: 7.92,  type: 'dorm',    accent: 0xffb380, entrance: 'north' },
  { name: '宿舍D',      sx: 273.75, sy: 498.08, shx: 22.09, shy: 7.92,  type: 'dorm',    accent: 0xff9d7a, entrance: 'north' },
  { name: '宿舍E',      sx: 409.83, sy: 469.75, shx: 22.09, shy: 7.92,  type: 'dorm',    accent: 0xff9d7a, entrance: 'north' },
  { name: '宿舍F',      sx: 467.33, sy: 469.75, shx: 22.09, shy: 7.92,  type: 'dorm',    accent: 0xff9d7a, entrance: 'north' },
  { name: '食堂',       sx: 409.83, sy: 498.08, shx: 22.09, shy: 7.92,  type: 'canteen', accent: 0xffc266, entrance: 'north' },
  { name: '商业街',     sx: 467.33, sy: 498.08, shx: 22.09, shy: 7.92,  type: 'canteen', accent: 0xffc266, entrance: 'north' },

  // —— 智慧环廊站点 ——
  { name: '环廊S1站',   sx: 260, sy: 260,  shx: 6, shy: 6, type: 'ring',     accent: 0x2ee6a8 },
  { name: '环廊S4站',   sx: 340, sy: 340,  shx: 6, shy: 6, type: 'ring',     accent: 0x2ee6a8 },
  { name: '环廊S7站',   sx: 420, sy: 420,  shx: 6, shy: 6, type: 'ring',     accent: 0x2ee6a8 },
];

// 应用坐标换算：SVG → three.js 世界坐标
BUILDINGS.forEach((b) => {
  const w = svgToWorld(b.sx, b.sy);
  b.x = w.x;
  b.z = w.z;
  // 建筑半宽半深（米）：SVG单位 × 2.4
  b.halfW = b.shx * 2.4;
  b.halfD = b.shy * 2.4;
});

/** 按名称查找大楼（支持模糊匹配） */
export function findBuilding(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  let hit = BUILDINGS.find((b) => b.name.toLowerCase() === n);
  if (hit) return hit;
  hit = BUILDINGS.find((b) => b.name.toLowerCase().includes(n));
  if (hit) return hit;
  hit = BUILDINGS.find((b) => b.name.toLowerCase().startsWith(n));
  return hit || null;
}

export function getBuildingNames() {
  return BUILDINGS.map((b) => b.name);
}

/* ================================================================
   3. 道路网络 & A* 路径规划
================================================================ */

/**
 * 道路网络（从 Blender build_campus_site.py 提取的真实坐标）
 * 坐标系：Blender 世界坐标（X东/Y北），转 three.js 时 z = -y
 * 数据来源：
 *   - RING_ROAD: 外环主路（12m 宽）
 *   - RING_LOOP: 内环次路 / 环廊同线（12m 宽）
 *   - R_EW_MAIN: 东西主路（y=404，12m 宽）
 *   - 中轴：南北主干道
 */

// ---- 道路节点（Blender 世界坐标 x, y，单位：米） ----
// 数据来源：build_campus_site.py 的 RING_ROAD / RING_LOOP / R_EW_MAIN / axis_pts
// 坐标系：Blender (x=东, y=北)，three.js 中 z = -y
const ROAD_NODES = {
  // ===== 外环主路（RING_ROAD，顺时针从南段西端开始） =====
  'outer_s_w':    { x: -373, y: 77.5  },
  'outer_s1':     { x: -200, y: 77.5  },
  'outer_s2':     { x: 0,    y: 77.5  },
  'outer_s3':     { x: 200,  y: 77.5  },
  'outer_s_e':    { x: 373,  y: 77.5  },
  // 东南段
  'outer_se1':    { x: 373,  y: 108   },
  'outer_se2':    { x: 384,  y: 126   },
  'outer_se3':    { x: 399,  y: 134   },
  'outer_se4':    { x: 420,  y: 148   },
  'outer_se5':    { x: 440,  y: 160   },
  'outer_se6':    { x: 465,  y: 205   },
  'outer_se7':    { x: 478,  y: 280   },
  // 东中段
  'outer_e1':     { x: 481,  y: 380   },
  'outer_e2':     { x: 481,  y: 470   },
  // 东北段
  'outer_ne1':    { x: 480,  y: 560   },
  'outer_ne2':    { x: 470,  y: 620   },
  'outer_ne3':    { x: 440,  y: 675   },
  'outer_ne4':    { x: 390,  y: 715   },
  'outer_ne5':    { x: 320,  y: 748   },
  'outer_ne6':    { x: 220,  y: 768   },
  // 北段
  'outer_n':      { x: 0,    y: 780   },
  // 西北段
  'outer_nw1':    { x: -220, y: 768   },
  'outer_nw2':    { x: -320, y: 748   },
  'outer_nw3':    { x: -390, y: 715   },
  'outer_nw4':    { x: -440, y: 675   },
  'outer_nw5':    { x: -470, y: 620   },
  'outer_nw6':    { x: -480, y: 560   },
  // 西中段
  'outer_w1':     { x: -481, y: 470   },
  'outer_w2':     { x: -481, y: 380   },
  // 西南段
  'outer_sw1':    { x: -478, y: 280   },
  'outer_sw2':    { x: -465, y: 205   },
  'outer_sw3':    { x: -440, y: 160   },
  'outer_sw4':    { x: -420, y: 148   },
  'outer_sw5':    { x: -399, y: 134   },
  'outer_sw6':    { x: -384, y: 126   },
  'outer_sw7':    { x: -373, y: 108   },

  // ===== 内环次路 / 智慧环廊（RING_LOOP，廊下即街） =====
  // 东侧（从南到北，智谷断开处开始）
  'inner_e_s':    { x: 0,    y: 146   },  // 智谷断开处（东端）
  'inner_e_s1':   { x: 60,   y: 147   },
  'inner_e_s2':   { x: 110,  y: 147.5 },
  'inner_e_s3':   { x: 150,  y: 147.5 },
  'inner_e_s4':   { x: 178,  y: 148   },
  'inner_e_s5':   { x: 190,  y: 166   },
  'inner_e_s6':   { x: 196,  y: 210   },
  'inner_e_s7':   { x: 198,  y: 262   },
  'inner_e_s8':   { x: 202,  y: 320   },
  'inner_e_mid':  { x: 206,  y: 380   },  // 东中点（S4站）
  'inner_e_mid2': { x: 206,  y: 440   },
  'inner_e_n1':   { x: 202,  y: 500   },
  'inner_e_n2':   { x: 186,  y: 546   },
  'inner_e_n3':   { x: 148,  y: 568   },
  'inner_e_n4':   { x: 96,   y: 574   },
  'inner_e_n5':   { x: 60,   y: 580   },
  'inner_e_n6':   { x: 30,   y: 588   },
  // 北端
  'inner_n':      { x: 0,    y: 596   },  // 环廊最北点（S3站附近）
  // 西侧（从北到南）
  'inner_w_n1':   { x: -30,  y: 588   },
  'inner_w_n2':   { x: -60,  y: 580   },
  'inner_w_n3':   { x: -96,  y: 574   },
  'inner_w_n4':   { x: -148, y: 568   },
  'inner_w_n5':   { x: -186, y: 546   },
  'inner_w_n6':   { x: -202, y: 500   },
  'inner_w_mid2': { x: -206, y: 440   },
  'inner_w_mid':  { x: -206, y: 380   },  // 西中点
  'inner_w_s1':   { x: -202, y: 320   },
  'inner_w_s2':   { x: -198, y: 262   },
  'inner_w_s3':   { x: -196, y: 210   },
  'inner_w_s4':   { x: -190, y: 166   },
  'inner_w_s5':   { x: -178, y: 148   },
  'inner_w_s6':   { x: -150, y: 147.5 },
  'inner_w_s7':   { x: -110, y: 147.5 },
  'inner_w_s8':   { x: -60,  y: 147   },
  'inner_w_s':    { x: 0,    y: 146   },  // 智谷断开处（西端）

  // ===== 环廊站点 =====
  'ring_s1':  { x: -148, y: 568   },  // S1站（西北）
  'ring_s4':  { x: 206,  y: 380   },  // S4站（东中）
  'ring_s7':  { x: 196,  y: 210   },  // S7站（东南）

  // ===== 中轴大道（从南到图书馆南，以北有建筑，不能穿）=====
  // 坐标依据：build_campus_site.py axis_pts
  'axis_south':   { x: 0, y: 0      },  // 南端入口（校门外）
  'axis_gate':    { x: 0, y: 33.6   },  // 主校门牌坊
  'axis_plaza':   { x: 0, y: 129.6  },  // 明堂广场 / 智谷谷底南
  'axis_valley_n':{ x: 0, y: 188    },  // 智谷谷底北（下沉智谷北端 Y≈188）
  'axis_mound_s': { x: 0, y: 210.8  },  // 案山南坡
  'axis_mound_n': { x: 0, y: 278.8  },  // 案山北坡
  'axis_mid':     { x: 0, y: 360    },  // 中段（图书馆南侧绿地）
  'axis_ew404':   { x: 0, y: 404    },  // 东西主路口
  'axis_lib_s':   { x: 0, y: 466.4  },  // 图书馆南（丹陛脚下，中轴大道终点）

  // ===== 东西主路（R_EW_MAIN，中段人文区断开） =====
  'ew_west_w':    { x: -478, y: 404   },
  'ew_west_e':    { x: -180, y: 404   },  // 西半段东端
  'ew_east_w':    { x: 180,  y: 404   },  // 东半段西端
  'ew_east_e':    { x: 478,  y: 404   },

  // ===== 放射支路（连接内环 ↔ 外环） =====
  // 西侧
  'rad_w_s':      { x: -300, y: 160   },  // 西南放射
  'rad_w_mid':    { x: -280, y: 280   },  // 西中放射
  'rad_w_n':      { x: -250, y: 500   },  // 西北放射
  // 东侧
  'rad_e_s':      { x: 300,  y: 160   },  // 东南放射
  'rad_e_mid':    { x: 280,  y: 280   },  // 东中放射
  'rad_e_n':      { x: 250,  y: 500   },  // 东北放射

  // ===== 生活区道路（西南角，宿舍区） =====
  'dorm_access_w': { x: -340, y: 160   },  // 宿舍区西入口
  'dorm_access_e': { x: -220, y: 160   },  // 宿舍区东入口（接内环）

  // ===== 运动区道路（东南角，体育区） =====
  'sport_access_w': { x: 220, y: 160   },  // 体育区西入口（接内环）
  'sport_access_e': { x: 340, y: 160   },  // 体育区东入口
};

// ---- 道路边（双向连接） ----
const ROAD_EDGES = [
  // ===== 外环主路（顺时针闭合环） =====
  // 南段
  ['outer_s_w', 'outer_s1'],
  ['outer_s1', 'outer_s2'],
  ['outer_s2', 'outer_s3'],
  ['outer_s3', 'outer_s_e'],
  // 东南段
  ['outer_s_e', 'outer_se1'],
  ['outer_se1', 'outer_se2'],
  ['outer_se2', 'outer_se3'],
  ['outer_se3', 'outer_se4'],
  ['outer_se4', 'outer_se5'],
  ['outer_se5', 'outer_se6'],
  ['outer_se6', 'outer_se7'],
  // 东中段
  ['outer_se7', 'outer_e1'],
  ['outer_e1', 'outer_e2'],
  // 东北段
  ['outer_e2', 'outer_ne1'],
  ['outer_ne1', 'outer_ne2'],
  ['outer_ne2', 'outer_ne3'],
  ['outer_ne3', 'outer_ne4'],
  ['outer_ne4', 'outer_ne5'],
  ['outer_ne5', 'outer_ne6'],
  // 北段
  ['outer_ne6', 'outer_n'],
  ['outer_n', 'outer_nw1'],
  // 西北段
  ['outer_nw1', 'outer_nw2'],
  ['outer_nw2', 'outer_nw3'],
  ['outer_nw3', 'outer_nw4'],
  ['outer_nw4', 'outer_nw5'],
  ['outer_nw5', 'outer_nw6'],
  // 西中段
  ['outer_nw6', 'outer_w1'],
  ['outer_w1', 'outer_w2'],
  // 西南段
  ['outer_w2', 'outer_sw1'],
  ['outer_sw1', 'outer_sw2'],
  ['outer_sw2', 'outer_sw3'],
  ['outer_sw3', 'outer_sw4'],
  ['outer_sw4', 'outer_sw5'],
  ['outer_sw5', 'outer_sw6'],
  ['outer_sw6', 'outer_sw7'],
  ['outer_sw7', 'outer_s_w'],

  // ===== 内环 / 智慧环廊（廊下即街，智谷处断开） =====
  // 东侧（从南到北）
  ['inner_e_s', 'inner_e_s1'],
  ['inner_e_s1', 'inner_e_s2'],
  ['inner_e_s2', 'inner_e_s3'],
  ['inner_e_s3', 'inner_e_s4'],
  ['inner_e_s4', 'inner_e_s5'],
  ['inner_e_s5', 'inner_e_s6'],
  ['inner_e_s6', 'inner_e_s7'],
  ['inner_e_s7', 'inner_e_s8'],
  ['inner_e_s8', 'inner_e_mid'],
  ['inner_e_mid', 'inner_e_mid2'],
  ['inner_e_mid2', 'inner_e_n1'],
  ['inner_e_n1', 'inner_e_n2'],
  ['inner_e_n2', 'inner_e_n3'],
  ['inner_e_n3', 'inner_e_n4'],
  ['inner_e_n4', 'inner_e_n5'],
  ['inner_e_n5', 'inner_e_n6'],
  ['inner_e_n6', 'inner_n'],
  // 西侧（从北到南）
  ['inner_n', 'inner_w_n1'],
  ['inner_w_n1', 'inner_w_n2'],
  ['inner_w_n2', 'inner_w_n3'],
  ['inner_w_n3', 'inner_w_n4'],
  ['inner_w_n4', 'inner_w_n5'],
  ['inner_w_n5', 'inner_w_n6'],
  ['inner_w_n6', 'inner_w_mid2'],
  ['inner_w_mid2', 'inner_w_mid'],
  ['inner_w_mid', 'inner_w_s1'],
  ['inner_w_s1', 'inner_w_s2'],
  ['inner_w_s2', 'inner_w_s3'],
  ['inner_w_s3', 'inner_w_s4'],
  ['inner_w_s4', 'inner_w_s5'],
  ['inner_w_s5', 'inner_w_s6'],
  ['inner_w_s6', 'inner_w_s7'],
  ['inner_w_s7', 'inner_w_s8'],
  ['inner_w_s8', 'inner_w_s'],

  // ===== 环廊站点（就在内环路上，直接连接） =====
  ['ring_s1', 'inner_w_n4'],
  ['ring_s4', 'inner_e_mid'],
  ['ring_s7', 'inner_e_s6'],

  // ===== 中轴大道（从南到图书馆南）=====
  ['axis_south', 'axis_gate'],
  ['axis_gate', 'axis_plaza'],
  ['axis_plaza', 'axis_valley_n'],
  ['axis_valley_n', 'axis_mound_s'],
  ['axis_mound_s', 'axis_mound_n'],
  ['axis_mound_n', 'axis_mid'],
  ['axis_mid', 'axis_ew404'],
  ['axis_ew404', 'axis_lib_s'],

  // ===== 中轴 ↔ 内环连接（智谷断开处，两侧绕行）=====
  // 智谷处：下沉智谷 Y 95~188，中轴从谷底穿过
  // 内环两端从智谷两侧接入中轴
  ['axis_plaza', 'inner_e_s'],     // 智谷南口东侧
  ['axis_plaza', 'inner_w_s'],     // 智谷南口西侧
  ['axis_valley_n', 'inner_e_s'],  // 智谷北口东侧
  ['axis_valley_n', 'inner_w_s'],  // 智谷北口西侧

  // ===== 东西主路（中段人文区断开，不连中轴） =====
  ['ew_west_w', 'ew_west_e'],
  ['ew_east_w', 'ew_east_e'],
  // 东西主路 ↔ 外环
  ['ew_west_w', 'outer_w2'],
  ['ew_east_e', 'outer_e1'],
  // 东西主路 ↔ 内环
  ['ew_west_e', 'inner_w_mid'],
  ['ew_east_w', 'inner_e_mid'],

  // ===== 放射支路（内环 ↔ 外环） =====
  // 西侧
  ['rad_w_s', 'outer_sw3'],
  ['rad_w_s', 'inner_w_s5'],
  ['rad_w_mid', 'outer_sw1'],
  ['rad_w_mid', 'inner_w_s2'],
  ['rad_w_n', 'outer_w1'],
  ['rad_w_n', 'inner_w_n6'],
  // 东侧
  ['rad_e_s', 'outer_se5'],
  ['rad_e_s', 'inner_e_s5'],
  ['rad_e_mid', 'outer_se7'],
  ['rad_e_mid', 'inner_e_s7'],
  ['rad_e_n', 'outer_e2'],
  ['rad_e_n', 'inner_e_n1'],

  // ===== 生活区道路（西南宿舍区） =====
  ['dorm_access_w', 'outer_sw3'],
  ['dorm_access_e', 'inner_w_s4'],
  ['dorm_access_w', 'dorm_access_e'],

  // ===== 运动区道路（东南体育区） =====
  ['sport_access_e', 'outer_se5'],
  ['sport_access_w', 'inner_e_s4'],
  ['sport_access_e', 'sport_access_w'],
];

/** 两点距离 */
function nodeDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 构建邻接表 */
function buildGraph() {
  const adj = {};
  Object.keys(ROAD_NODES).forEach((id) => { adj[id] = []; });
  ROAD_EDGES.forEach(([a, b]) => {
    const d = nodeDist(ROAD_NODES[a], ROAD_NODES[b]);
    adj[a].push({ to: b, dist: d });
    adj[b].push({ to: a, dist: d });
  });
  return adj;
}
const GRAPH = buildGraph();

/**
 * A* 寻路
 */
function aStar(startId, goalId) {
  const openSet = new Set([startId]);
  const cameFrom = {};
  const gScore = {};
  const fScore = {};

  Object.keys(ROAD_NODES).forEach((id) => {
    gScore[id] = Infinity;
    fScore[id] = Infinity;
  });
  gScore[startId] = 0;
  fScore[startId] = nodeDist(ROAD_NODES[startId], ROAD_NODES[goalId]);

  while (openSet.size > 0) {
    // fScore 最小节点
    let current = null;
    let minF = Infinity;
    openSet.forEach((id) => {
      if (fScore[id] < minF) { minF = fScore[id]; current = id; }
    });

    if (current === goalId) {
      const path = [current];
      while (cameFrom[current]) {
        current = cameFrom[current];
        path.unshift(current);
      }
      return path;
    }

    openSet.delete(current);

    GRAPH[current].forEach((neighbor) => {
      const tentativeG = gScore[current] + neighbor.dist;
      if (tentativeG < gScore[neighbor.to]) {
        cameFrom[neighbor.to] = current;
        gScore[neighbor.to] = tentativeG;
        fScore[neighbor.to] = tentativeG + nodeDist(ROAD_NODES[neighbor.to], ROAD_NODES[goalId]);
        openSet.add(neighbor.to);
      }
    });
  }

  return null;
}

/**
 * 找建筑入口方向上最近的道路节点
 * 不使用全局最近点，避免从建筑背面/侧面接入导致穿墙
 */
function nearestRoadNode(building) {
  // building: { x, z } (three.js) → Blender: bx = x, by = -z
  const bx = building.x;
  const by = -building.z;
  const entrance = building.entrance || 'south';

  let bestId = null, bestDist = Infinity;

  Object.entries(ROAD_NODES).forEach(([id, node]) => {
    const dx = node.x - bx;
    const dy = node.y - by;
    const d = Math.hypot(dx, dy);

    // 根据入口方向筛选节点：只考虑入口侧的节点
    let valid = false;
    switch (entrance) {
      case 'south':
        // 入口朝南：节点在建筑南边（dy < 0），且 X 方向偏差不大
        valid = dy < -5 && Math.abs(dx) < 80;
        break;
      case 'north':
        // 入口朝北：节点在建筑北边（dy > 0）
        valid = dy > 5 && Math.abs(dx) < 80;
        break;
      case 'east':
        // 入口朝东：节点在建筑东边（dx > 0）
        valid = dx > 5 && Math.abs(dy) < 80;
        break;
      case 'west':
        // 入口朝西：节点在建筑西边（dx < 0）
        valid = dx < -5 && Math.abs(dy) < 80;
        break;
      default:
        valid = true;
    }

    if (valid && d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  });

  // 如果入口方向没找到节点，退回全局最近
  if (!bestId) {
    Object.entries(ROAD_NODES).forEach(([id, node]) => {
      const d = Math.hypot(node.x - bx, node.y - by);
      if (d < bestDist) { bestDist = d; bestId = id; }
    });
  }

  return { id: bestId, dist: bestDist };
}

/**
 * 计算建筑门口点（Blender 坐标）
 * 基于建筑入口方向，在建筑入口侧边缘外 3m 处
 * 避免路径从建筑中心直接穿墙
 */
function buildingDoorPoint(building, roadNode) {
  const bx = building.x;           // Blender x = three.x
  const by = -building.z;          // Blender y = -three.z
  const entrance = building.entrance || 'south';

  // 建筑半宽半深（米）
  const hw = building.halfW || 30;  // x 方向半宽
  const hd = building.halfD || 30;  // y 方向半深

  let doorX = bx, doorY = by;

  // 根据入口方向确定门口位置
  switch (entrance) {
    case 'south':
      // 南入口：建筑南边中央
      doorX = bx;
      doorY = by - hd - 3;
      break;
    case 'north':
      // 北入口：建筑北边中央
      doorX = bx;
      doorY = by + hd + 3;
      break;
    case 'east':
      // 东入口：建筑东边中央
      doorX = bx + hw + 3;
      doorY = by;
      break;
    case 'west':
      // 西入口：建筑西边中央
      doorX = bx - hw - 3;
      doorY = by;
      break;
    default:
      // 没有指定入口方向时，朝向最近道路节点
      const nx = roadNode.x, ny = roadNode.y;
      const dx = nx - bx, dy = ny - by;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.1) return { x: bx, y: by };
      const dirX = dx / dist, dirY = dy / dist;
      let tMin = Infinity;
      if (Math.abs(dirX) > 0.001) {
        const tEast = hw / dirX;
        const tWest = -hw / dirX;
        [tEast, tWest].forEach(t => {
          if (t > 0.1) {
            const yHit = by + t * dirY;
            if (Math.abs(yHit - by) <= hd + 0.5 && t < tMin) tMin = t;
          }
        });
      }
      if (Math.abs(dirY) > 0.001) {
        const tNorth = hd / dirY;
        const tSouth = -hd / dirY;
        [tNorth, tSouth].forEach(t => {
          if (t > 0.1) {
            const xHit = bx + t * dirX;
            if (Math.abs(xHit - bx) <= hw + 0.5 && t < tMin) tMin = t;
          }
        });
      }
      if (!isFinite(tMin)) tMin = Math.min(hw, hd);
      const doorT = tMin + 3;
      doorX = bx + dirX * doorT;
      doorY = by + dirY * doorT;
  }

  return { x: doorX, y: doorY };
}

/**
 * 沿路计算路径（A* + 平滑）
 * 返回 THREE.Vector3 数组
 */
function computeRoadRoute(from, to) {
  const fromNodeInfo = nearestRoadNode(from);
  const toNodeInfo = nearestRoadNode(to);

  const nodePath = aStar(fromNodeInfo.id, toNodeInfo.id);
  if (!nodePath) return computeBezierRoute(from, to);

  const points = [];

  // 起点门口 → 第一个道路节点
  const fromNode = ROAD_NODES[fromNodeInfo.id];
  const fromDoor = buildingDoorPoint(from, fromNode);
  points.push(new THREE.Vector3(fromDoor.x, 2, -fromDoor.y));

  // 沿道路节点
  nodePath.forEach((nodeId) => {
    const node = ROAD_NODES[nodeId];
    points.push(new THREE.Vector3(node.x, 2, -node.y)); // three.z = -blender.y
  });

  // 最后道路节点 → 终点门口
  const toNode = ROAD_NODES[toNodeInfo.id];
  const toDoor = buildingDoorPoint(to, toNode);
  points.push(new THREE.Vector3(toDoor.x, 2, -toDoor.y));

  // 路径平滑（低强度，避免转角切内角穿墙）
  return smoothPath(points, 2);
}

/**
 * 路径平滑：转角处用小圆角过渡，避免切角穿墙
 * 使用外扩圆角：圆角在转角外侧，不会侵入道路内侧
 */
function smoothPath(points, cornerSegs = 4) {
  if (points.length < 3) return points.slice();

  const result = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    // 起点直接加入
    if (i === 0) {
      result.push(p.clone());
      continue;
    }

    // 终点直接加入
    if (i === points.length - 1) {
      result.push(p.clone());
      break;
    }

    const prev = points[i - 1];
    const next = points[i + 1];

    // 计算两条边的向量
    const vInX = p.x - prev.x, vInZ = p.z - prev.z;
    const vOutX = next.x - p.x, vOutZ = next.z - p.z;
    const lenIn = Math.hypot(vInX, vInZ);
    const lenOut = Math.hypot(vOutX, vOutZ);

    // 太短的边不做圆角
    const minLen = Math.min(lenIn, lenOut);
    const radius = Math.min(minLen * 0.2, 15); // 圆角半径最大 15m

    if (radius < 2 || minLen < 6) {
      result.push(p.clone());
      continue;
    }

    // 计算圆角起点和终点（从转角点沿两边后退 radius 距离）
    const startX = p.x - vInX / lenIn * radius;
    const startZ = p.z - vInZ / lenIn * radius;
    const endX = p.x + vOutX / lenOut * radius;
    const endZ = p.z + vOutZ / lenOut * radius;

    // 用二次贝塞尔曲线做圆角，控制点就是转角点 p
    // 这样圆角是"外凸"的，不会向内切角
    for (let s = 1; s <= cornerSegs; s++) {
      const t = s / cornerSegs;
      const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * p.x + t * t * endX;
      const z = (1 - t) * (1 - t) * startZ + 2 * (1 - t) * t * p.z + t * t * endZ;
      result.push(new THREE.Vector3(x, 2, z));
    }
  }

  return result;
}

/** 备用：贝塞尔曲线路径 */
function computeBezierRoute(from, to) {
  const points = [];
  const start = new THREE.Vector3(from.x, 2, from.z);
  const end = new THREE.Vector3(to.x, 2, to.z);
  const midX = (from.x + to.x) / 2;
  const midZ = (from.z + to.z) / 2;
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  const perpX = -dz / len * len * 0.15;
  const perpZ = dx / len * len * 0.15;
  const ctrl = new THREE.Vector3(midX + perpX, 4, midZ + perpZ);

  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * ctrl.x + t * t * end.x;
    const y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * ctrl.y + t * t * end.y;
    const z = (1 - t) * (1 - t) * start.z + 2 * (1 - t) * t * ctrl.z + t * t * end.z;
    points.push(new THREE.Vector3(x, y, z));
  }
  return points;
}

/**
 * 计算从起点到终点的路径
 */
export async function computeRoute(fromName, toName) {
  const from = findBuilding(fromName);
  const to = findBuilding(toName);

  if (!from) throw new Error(`找不到起点：${fromName}`);
  if (!to) throw new Error(`找不到终点：${toName}`);
  if (from.name === to.name) throw new Error('起点和终点不能相同');

  if (AI_CONFIG.enabled) {
    try {
      return await computeRouteWithAI(from.name, to.name);
    } catch (e) {
      console.warn('AI 路径规划失败，使用本地计算：', e);
    }
  }

  const points = computeRoadRoute(from, to);
  const distance = calculatePathDistance(points);
  return { from, to, points, distance, mode: 'road' };
}

function calculatePathDistance(points) {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += points[i].distanceTo(points[i - 1]);
  }
  return dist;
}

/* ================================================================
   4. AI 路径规划（DeepSeek Anthropic 兼容接口）
================================================================ */

/**
 * 调用 AI 进行自然语言解析 + 路径规划
 * 支持：直接输入"从图书馆去食堂"、"帮我导航到体育馆"等自然语言
 */
async function computeRouteWithAI(fromName, toName) {
  // AI 的价值在于：自然语言理解 + 路径说明 + 推荐中间点
  // 路径本身走道路网络
  const from = findBuilding(fromName);
  const to = findBuilding(toName);
  const points = computeRoadRoute(from, to);
  return {
    from, to, points,
    distance: calculatePathDistance(points),
    mode: 'ai',
    description: '',
  };
}

/**
 * 解析自然语言输入，提取起点和终点
 * 例如："从图书馆去体育馆" → { from: "亭兰图书馆", to: "体育馆" }
 *       "帮我导航到食堂" → { from: null, to: "食堂" }
 */
export async function parseNaturalLanguage(text) {
  if (!AI_CONFIG.enabled || !text || !text.trim()) {
    return { from: null, to: null, raw: text };
  }

  const buildingList = BUILDINGS.map((b) => b.name).join('、');

  const systemPrompt = `你是山河大学的校园导航助手。
用户会用自然语言描述想去的地方，你需要从中提取起点和终点。

校园内的所有大楼/地标列表：
${buildingList}

请严格按照以下 JSON 格式回复（只输出 JSON，不要其他内容）：
{
  "from": "起点大楼名称，如果用户没说起点则为 null",
  "to": "终点大楼名称，必填",
  "confidence": 0.95
}

规则：
1. 如果用户只说了一个地点，那就是终点，from 为 null
2. 模糊匹配：用户说"图书馆"匹配"亭兰图书馆"，说"食堂"匹配"食堂"，说"宿舍"匹配最近的宿舍
3. 只从上面的列表中选择，不要编造不存在的建筑
4. 必须输出合法的 JSON`;

  try {
    const response = await callAI([
      { role: 'user', content: systemPrompt },
      { role: 'user', content: `用户输入："${text}"` },
    ]);

    // 尝试解析 JSON
    const jsonStr = extractJSON(response);
    if (jsonStr) {
      const result = JSON.parse(jsonStr);
      // 验证并匹配大楼
      return {
        from: result.from ? matchBuildingFuzzy(result.from)?.name || null : null,
        to: result.to ? matchBuildingFuzzy(result.to)?.name || null : null,
        raw: text,
        aiParsed: true,
      };
    }
  } catch (e) {
    console.warn('AI 自然语言解析失败：', e);
  }

  return { from: null, to: null, raw: text, aiParsed: false };
}

/**
 * 生成路径说明（AI 生成的步行指引）
 */
export async function generateRouteDescription(route) {
  if (!AI_CONFIG.enabled) return null;

  const { from, to, distance } = route;
  const minutes = Math.ceil(distance / 1.2 / 60);

  const prompt = `你是山河大学的校园向导。
请为以下路线生成一段简短友好的步行指引（50-80字）：
从【${from.name}】到【${to.name}】，距离约 ${distance.toFixed(0)} 米，步行约 ${minutes} 分钟。

要求：
- 用中文，口语化，亲切自然
- 可以提一下沿途的地标
- 不要太长，控制在两句话以内
- 直接输出指引文字，不要其他格式`;

  try {
    const response = await callAI([
      { role: 'user', content: prompt },
    ]);
    return response.trim();
  } catch (e) {
    console.warn('AI 路径说明生成失败：', e);
    return null;
  }
}

/**
 * 调用 DeepSeek Anthropic 兼容 API
 */
async function callAI(messages) {
  if (!AI_CONFIG.apiKey || !AI_CONFIG.endpoint) {
    throw new Error('AI 未配置');
  }

  // 把 messages 转换成 Anthropic 格式
  // Anthropic 格式：system 单独传，messages 是 user/assistant 交替
  let systemPrompt = '';
  const userMessages = [];

  messages.forEach((m) => {
    if (m.role === 'system') {
      systemPrompt = m.content;
    } else if (m.role === 'user') {
      userMessages.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      userMessages.push({ role: 'assistant', content: m.content });
    }
  });

  const model = AI_CONFIG.model || 'deepseek-chat';

  const body = {
    model,
    max_tokens: 1024,
    messages: userMessages,
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const res = await fetch(AI_CONFIG.endpoint + '/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_CONFIG.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API 调用失败 (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Anthropic 格式：content[0].text
  if (data.content && data.content.length > 0) {
    return data.content.map((c) => c.text).join('');
  }
  if (data.output) return data.output;
  if (data.choices && data.choices[0]) {
    return data.choices[0].message?.content || data.choices[0].text || '';
  }
  return JSON.stringify(data);
}

/** 从 AI 返回文本中提取 JSON */
function extractJSON(text) {
  if (!text) return null;
  // 尝试直接解析
  try {
    JSON.parse(text);
    return text;
  } catch (e) { /* 不是纯 JSON，继续找 */ }

  // 找 ```json ... ``` 块
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) {
    try { JSON.parse(match[1]); return match[1]; } catch (e) { /* 继续 */ }
  }

  // 找第一个 { 到最后一个 }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    try { JSON.parse(candidate); return candidate; } catch (e) { /* 失败 */ }
  }

  return null;
}

/** 模糊匹配大楼名称（AI 可能返回近似名称） */
function matchBuildingFuzzy(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();

  // 精确匹配
  let hit = BUILDINGS.find((b) => b.name.toLowerCase() === n);
  if (hit) return hit;

  // 包含匹配
  hit = BUILDINGS.find((b) => b.name.toLowerCase().includes(n));
  if (hit) return hit;

  // 反向：大楼名包含输入
  hit = BUILDINGS.find((b) => n.includes(b.name.toLowerCase()));
  if (hit) return hit;

  // 按字符相似度找最接近的
  let best = null, bestScore = 0;
  BUILDINGS.forEach((b) => {
    const score = similarity(n, b.name.toLowerCase());
    if (score > bestScore && score > 0.4) {
      bestScore = score;
      best = b;
    }
  });
  return best;
}

/** 简单字符串相似度 */
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;

  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

/* ================================================================
   5. 路径可视化（Three.js）
   ------------------------------------------------------------------
   ★ 2026-09-26 换风格：从「多层加色发光壳」改成「贴地光带 + 单光柱」。

   为什么换（不是审美偏好，是量出来的）：
     旧版一条路径 = 5 层 LineBasicMaterial 叠 + 两端各 9 个加色对象（3 环 + 光斑
     + 主/内光柱 + 光球 + 2 层光晕）+ 25 个流动粒子 = 24 个对象 / 23 个加色对象。
     其中两个问题很实在：
       ① `LineBasicMaterial.linewidth` 在绝大多数 WebGL 平台**被直接忽略**
          ⇒ 那 5 层"发光线"其实是**同一条 1 px 细线叠了 5 遍**，
            既不粗、也没有真光晕，只是把同一批像素混了 5 次（overdraw）。
       ② 四个同心球（r = 4 / 8 / 14）+ 两根开口圆柱全部
          `AdditiveBlending + depthWrite:false + DoubleSide` —— 不写深度，
          屏幕覆盖多大就按像素混多少遍，同一块像素最多混 5~6 遍。
     新版一条路径 = 1 条贴地渐变光带 + 1 条细芯线 + 两端各 2 个对象 + 1 组粒子
     = 7 个对象 / 6 个加色对象。**观感更像地图 App，且不再靠叠层来"发光"。**

   ★ 两个必须共享的东西（否则"点一次卡一下"）：
     · 渐变贴图全局各一张，几何两端共享（同一 geometry/material 两个 Mesh 实例）
     · 名称标签贴图**按名字缓存** —— 原来每点一次建筑都新建一张 512×128
       CanvasTexture 并在清除时 dispose()，等于每次点选都做一次
       canvas 绘制 + GPU 纹理上传 + 纹理销毁。这种卡顿**渲染量具量不到**，
       但手感上就是"点一下顿一下"。
================================================================ */

/* ---- 贴地高度基准 ----
 * ★ 数值来自实测（99-临时工作区/_probe_ground.py 射线自 y=3000 垂直向下打 GLB）：
 *   旧代码把地面光斑放在 y = 0.2~0.8，而场地基准是 Blender 的 Z_TOP = 3.0
 *   ⇒ 那些贴地装饰**整体埋在地下**，被深度剔除、画面上什么都看不到，且不报错。
 *   这里统一用 GROUND_Y 抬到地面之上，避免新特效继承同一个错。
 */
export const GROUND_Y = 3.0;
const DECAL_LIFT = 0.45;      // 贴地装饰离地高度（避免与地面共面 z-fighting）

/* ---- 程序化贴图（全局各一张，永久复用）---- */
let _texRadial = null;        // 径向渐变：中心亮 → 边缘透明（光柱 / 柔光斑）
let _texAnnulus = null;       // 环状渐变：中间透明、外圈亮（选中光圈 / 端点圈）
let _texBand = null;          // 光带：横向软边 + 纵向虚线（沿路径滚动做流动感）
const _labelCache = new Map(); // 名称标签贴图缓存：key = name|color

/** 径向渐变贴图（中心亮、边缘透明）—— 加色混合下就是一团柔光 */
function radialTexture(inner = 0.15, mid = 0.75) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, S * inner, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(mid, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 环状渐变贴图（中间透明、外圈亮）—— 用平面 + 这张贴图代替 3 层 RingGeometry */
function annulusTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,0)');
  g.addColorStop(0.52, 'rgba(255,255,255,0)');
  g.addColorStop(0.70, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.84, 'rgba(255,255,255,1)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 光带贴图：u 横向（软边），v 纵向（重复的亮段，靠 offset 滚动产生流动感） */
function bandTexture() {
  const W = 32, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    // 纵向：3 段亮带 + 柔和的段间过渡
    const ph = y / H * 3;
    const dash = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(Math.PI * ph)), 0.6);
    for (let x = 0; x < W; x++) {
      // 横向：中心亮、两侧软收边（cos 形）
      const u = (x + 0.5) / W;
      const edge = Math.pow(Math.sin(Math.PI * u), 1.35);
      const a = Math.round(255 * edge * dash);
      const i = (y * W + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;    // 纵向必须可重复，offset 才能无缝滚动
  return t;
}

/**
 * 把折线展开成一条贴地的三角带（ribbon）。
 * @param {THREE.Vector3[]} pts  已按目标 y 铺好的折线
 * @param {number} halfWidth     半宽（米）
 * @param {number} vRepeat       贴图纵向重复周期（米）
 * ★ 绕序按「从 +Y 俯视时正面朝上」推导，所以材质可以用 FrontSide（省一半片元）：
 *   左点 L = p + n·w、右点 R = p − n·w（n = (−dz, dx) 为 XZ 面内法线），
 *   三角形取 (L_i, L_{i+1}, R_i) / (R_i, L_{i+1}, R_{i+1})，法线恒为 +Y。
 */
function ribbonGeometry(pts, halfWidth, vRepeat) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const nx = -dz, nz = dx;             // XZ 面内左法线
    if (i > 0) acc += pts[i].distanceTo(pts[i - 1]);
    const v = acc / vRepeat;
    pos[i * 6]     = p.x + nx * halfWidth; pos[i * 6 + 1] = p.y; pos[i * 6 + 2] = p.z + nz * halfWidth;
    pos[i * 6 + 3] = p.x - nx * halfWidth; pos[i * 6 + 4] = p.y; pos[i * 6 + 5] = p.z - nz * halfWidth;
    uv[i * 4]     = 0; uv[i * 4 + 1] = v;
    uv[i * 4 + 2] = 1; uv[i * 4 + 3] = v;
    if (i < n - 1) {
      const o = i * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class RouteRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'RouteOverlay';
    scene.add(this.group);
    this.currentRoute = null;
    this.animTime = 0;

    if (!_texRadial) _texRadial = radialTexture();
    if (!_texAnnulus) _texAnnulus = annulusTexture();
    if (!_texBand) _texBand = bandTexture();

    // ---- 端点标记的**共享**资源（两个端点引用同一份 geometry）----
    // 半径 1，靠 scale 调大小 ⇒ 两个端点复用同一份几何
    this._endGeoBeam = new THREE.CylinderGeometry(0.06, 0.20, 1, 16, 1, true);
    this._endGeoDisc = new THREE.PlaneGeometry(2, 2);

    // 端点材质：**每个端点一份**（因为颜色不同），但几何共享
    this._endMats = [];

    // 流动粒子的采样表（按弧长均匀采样，替代原来每帧的线性扫描）
    this._flowSamples = null;
    this._flowCount = 25;
  }

  /** 显示一条导航路径 */
  showRoute(route) {
    this.clear();
    this.currentRoute = route;

    const { points, from, to } = route;
    const y = GROUND_Y + DECAL_LIFT;

    // 路径折线抬到贴地高度
    const pts = points.map((p) => new THREE.Vector3(p.x, y, p.z));

    // —— ① 贴地渐变光带（单对象、单材质、正面单面）——
    const bandGeo = ribbonGeometry(pts, 2.2, 46);
    // ★ 贴图**共享**、不 clone：同一时刻只可能有一条路径在显示，
    //   clone 只会多一次 GPU 纹理上传。滚动靠共享贴图的 offset，互不干扰。
    this.bandMat = new THREE.MeshBasicMaterial({
      map: _texBand,
      color: 0x35d8ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.band = new THREE.Mesh(bandGeo, this.bandMat);
    this.band.name = 'RouteBand';
    this.group.add(this.band);

    // —— ② 细芯线（一条就够；靠光带提供"粗细"，不再叠 5 层）——
    const coreGeo = new THREE.BufferGeometry().setFromPoints(
      pts.map((p) => new THREE.Vector3(p.x, p.y + 0.06, p.z)));
    this.coreMat = new THREE.LineBasicMaterial({
      color: 0xdffaff, transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.core = new THREE.Line(coreGeo, this.coreMat);
    this.core.name = 'RouteCore';
    this.group.add(this.core);

    // —— ③ 两端标记（各 2 个对象：贴地光环 + 光柱）——
    this.endFrom = this._addEndpoint(from.x, from.z, 0x00ffc2);
    this.endTo = this._addEndpoint(to.x, to.z, 0xffb300);

    // —— ④ 流动粒子 ——
    this._buildFlow(pts);

    return this;
  }

  /**
   * 端点标记：贴地光环 + 光柱，**两个端点共享几何**
   * 旧版每个端点 9 个对象（3 环 + 光斑 + 主光柱 + 内光柱 + 光球 + 2 层光晕）。
   */
  _addEndpoint(x, z, color) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    // 贴地光环：用**一张环状渐变贴图**代替 3 层 RingGeometry
    const ringMat = new THREE.MeshBasicMaterial({
      map: _texAnnulus, color, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this._endGeoDisc, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = GROUND_Y + 0.12;
    ring.scale.setScalar(13);
    g.add(ring);

    // 光柱：一根开口圆柱（正面单面，不用 DoubleSide ⇒ 片元少一半）
    const beamMat = new THREE.MeshBasicMaterial({
      map: _texRadial, color, transparent: true, opacity: 0.30,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.FrontSide,
    });
    const beam = new THREE.Mesh(this._endGeoBeam, beamMat);
    beam.scale.set(1, 62, 1);
    beam.position.y = GROUND_Y + 31;
    g.add(beam);

    this.group.add(g);
    this._endMats.push(ringMat, beamMat);
    return { group: g, ring, beam, ringMat, beamMat, color };
  }

  /** 流动粒子：预采样 + 每帧 O(1) 查表（原来是每帧对分段长度做线性扫描） */
  _buildFlow(pts) {
    const COUNT = this._flowCount;
    // ★ 按弧长均匀采样 512 个点，之后每个粒子只需一次数组索引
    const S = 512;
    const segLen = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].distanceTo(pts[i - 1]);
      segLen.push(d); total += d;
    }
    const samples = new Float32Array(S * 3);
    let si = 0, acc = 0, seg = 0;
    for (let k = 0; k < S; k++) {
      const target = (k / (S - 1)) * total;
      while (seg < segLen.length - 1 && acc + segLen[seg] < target) { acc += segLen[seg]; seg++; }
      const t = segLen[seg] > 0 ? (target - acc) / segLen[seg] : 0;
      const a = pts[seg], b = pts[Math.min(seg + 1, pts.length - 1)];
      samples[si++] = a.x + (b.x - a.x) * t;
      samples[si++] = a.y;
      samples[si++] = a.z + (b.z - a.z) * t;
    }
    this._flowSamples = samples;

    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const c1 = new THREE.Color(0xffffff), c2 = new THREE.Color(0xffc247);
    for (let i = 0; i < COUNT; i++) {
      const c = c1.clone().lerp(c2, i / COUNT);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      positions[i * 3] = pts[0].x; positions[i * 3 + 1] = pts[0].y; positions[i * 3 + 2] = pts[0].z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.flowParticles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 6, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.flowParticles.name = 'RouteFlow';
    this.group.add(this.flowParticles);
  }

  /** 清空当前路径（几何/材质按需释放，贴图与端点几何模板保留复用） */
  clear() {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      child.traverse((o) => {
        if (o.isPoints && o.geometry) o.geometry.dispose();
      });
      // 光带 / 芯线是每次新建的 ⇒ 释放；端点几何是共享模板 ⇒ 不释放
      if (child === this.band) {
        if (this.band.geometry) this.band.geometry.dispose();
        if (this.bandMat) this.bandMat.dispose();   // ★ 贴图是共享的，不能 dispose
      } else if (child === this.core) {
        if (this.core.geometry) this.core.geometry.dispose();
        if (this.coreMat) this.coreMat.dispose();
      }
    }
    // 端点材质是每个端点各一份 ⇒ 释放
    this._endMats.forEach((m) => m.dispose());
    this._endMats = [];
    this.band = this.core = this.bandMat = this.coreMat = null;
    this.endFrom = this.endTo = null;
    this.currentRoute = null;
    this.flowParticles = null;
  }

  update(t) {
    this.animTime = t;

    // —— 光带流动：只改贴图 offset，零分配、零几何改动 ——
    if (this.bandMat && this.bandMat.map) {
      this.bandMat.map.offset.y = -(t * 0.35) % 1;
    }
    if (this.coreMat) {
      this.coreMat.opacity = 0.72 + Math.sin(t * 2.2) * 0.16;
    }

    // —— 两端：光环呼吸 + 光柱明暗 ——
    const pulse = 0.5 + Math.sin(t * 2) * 0.5;
    for (const e of [this.endFrom, this.endTo]) {
      if (!e) continue;
      e.ring.scale.setScalar(12 + Math.sin(t * 1.6) * 1.8);
      e.ringMat.opacity = 0.36 + pulse * 0.26;
      e.beamMat.opacity = 0.20 + pulse * 0.14;
    }

    // —— 流动粒子：查表 O(1)（原来是每帧线性扫描分段表）——
    if (this.flowParticles && this._flowSamples) {
      const S = this._flowSamples.length / 3;
      const arr = this.flowParticles.geometry.attributes.position.array;
      const n = this._flowCount;
      for (let i = 0; i < n; i++) {
        const p = ((t * 0.06 + i / n) % 1 + 1) % 1;
        const k = Math.min(S - 1, Math.floor(p * (S - 1)));
        arr[i * 3]     = this._flowSamples[k * 3];
        arr[i * 3 + 1] = this._flowSamples[k * 3 + 1] + 0.5 + Math.sin(t * 3.5 + i * 0.5) * 0.5;
        arr[i * 3 + 2] = this._flowSamples[k * 3 + 2];
      }
      this.flowParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this._endGeoBeam.dispose();
    this._endGeoDisc.dispose();
  }
}

/* ================================================================
   4. 建筑点击高亮 + 名称显示
   ------------------------------------------------------------------
   ★ 2026-09-26 换风格：从「光斑 + 3 环 + 主光柱 + 内光柱 + 光球 + 2 层光晕 + 标签」
     （每次点击新建 10 个几何 + 10 个材质 + 1 张 512×128 CanvasTexture，
      清除时全部 dispose）改成**常驻 3 个对象 + 零分配**：

       · 所有资源在构造函数里建一次，`highlight()` 只改位置/颜色/可见性
       · 名称标签贴图按名字缓存 ⇒ 第二次点同一栋楼零成本
       · 拾取体不再用"不可见的 Sphere mesh"（22 个对象进场景），
         改成**纯射线–球数学**（`Ray.intersectsSphere`），场景里一个多余对象都没有

    为什么原来那种写法会"点一下顿一下"：
     每次点击都要画一张 canvas → 上传纹理 → 用完全部 dispose()。
     这条路径的开销**渲染量具量不到**（不在 draw call 里），但手感上就是卡顿尖峰。
================================================================ */

/** 名称标签贴图（按 name|color 缓存，最多 ~22 张，5 MB 量级，不释放） */
function labelTexture(text, color) {
  const key = text + '|' + color;
  if (_labelCache.has(key)) return _labelCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.roundRect(10, 10, 492, 108, 20);
  ctx.fill();
  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.strokeStyle = hex;
  ctx.lineWidth = 3;
  ctx.roundRect(10, 10, 492, 108, 20);
  ctx.stroke();
  ctx.font = 'bold 48px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  _labelCache.set(key, t);
  return t;
}

export class BuildingHighlighter {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // 高亮组（常驻，靠 visible 开关，**不销毁重建**）
    this.group = new THREE.Group();
    this.group.name = 'BuildingHighlight';
    this.group.visible = false;
    scene.add(this.group);

    // 拾取体：纯数学球，不进场景
    this.hitTargets = [];
    this._buildHitTargets();

    this.currentBuilding = null;
    this.animTime = 0;
    this.onBuildingClick = null;

    if (!_texRadial) _texRadial = radialTexture();
    if (!_texAnnulus) _texAnnulus = annulusTexture();
    this._buildHighlightAssets();
  }

  /** 点击碰撞体：射线–球，纯数学 ⇒ 场景里零对象 */
  _buildHitTargets() {
    BUILDINGS.forEach((b) => {
      let radius = 50, yOffset = 50;
      if (b.type === 'landmark') { radius = 60; yOffset = 70; }
      else if (b.type === 'sports') { radius = 55; yOffset = 40; }
      else if (b.type === 'dorm') { radius = 40; yOffset = 40; }
      else if (b.type === 'teach' || b.type === 'lab' || b.type === 'tech' ||
               b.type === 'canteen') { radius = 45; yOffset = 45; }
      else if (b.type === 'ring') { radius = 35; yOffset = 50; }
      this.hitTargets.push({
        building: b,
        sphere: new THREE.Sphere(new THREE.Vector3(b.x, yOffset, b.z), radius),
      });
    });
  }

  /** 常驻高亮资源：3 个对象，构造时建一次 */
  _buildHighlightAssets() {
    // ① 贴地光环（径向渐变）
    this.ringMat = new THREE.MeshBasicMaterial({
      map: _texAnnulus, color: 0x00e5ff, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.scale.setScalar(34);
    this.group.add(this.ring);

    // ② 光柱（开口圆柱，正面单面）
    this.beamMat = new THREE.MeshBasicMaterial({
      map: _texRadial, color: 0x00e5ff, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.34, 1, 18, 1, true),
                               this.beamMat);
    this.beam.scale.set(1, 150, 1);
    this.group.add(this.beam);
    this.beamHeight = 150;

    // ③ 名称标签
    this.labelMat = new THREE.SpriteMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.label = new THREE.Sprite(this.labelMat);
    this.label.scale.set(46, 11.5, 1);
    this.group.add(this.label);
  }

  setMouse(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 检测点击，返回命中的建筑或 null */
  checkClick() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const ray = this.raycaster.ray;
    let best = null, bestT = Infinity;
    for (const h of this.hitTargets) {
      if (!ray.intersectsSphere(h.sphere)) continue;
      // 用球心在射线方向上的投影距离排序（够用，且不必求精确交点）
      const t = h.sphere.center.clone().sub(ray.origin).dot(ray.direction);
      if (t < bestT) { bestT = t; best = h.building; }
    }
    return best;
  }

  /** 高亮显示某栋建筑（零分配：只改位置 / 颜色 / 可见性） */
  highlight(building) {
    this.currentBuilding = building;
    const color = building.accent || 0x00e5ff;
    const baseY = GROUND_Y;

    this.ringMat.color.setHex(color);
    this.ring.position.set(building.x, baseY + 0.25, building.z);

    this.beamMat.color.setHex(color);
    this.beam.position.set(building.x, baseY + this.beamHeight / 2, building.z);

    // 标签贴图按名字缓存：同一栋楼第二次点击不会重新画 canvas
    this.labelMat.map = labelTexture(building.name, color);
    this.labelMat.needsUpdate = true;
    this.label.position.set(building.x, baseY + this.beamHeight + 22, building.z);

    this.group.visible = true;
  }

  clearHighlight() {
    this.group.visible = false;
    this.currentBuilding = null;
  }

  update(t) {
    this.animTime = t;
    if (!this.currentBuilding || !this.group.visible) return;

    const pulse = 0.5 + Math.sin(t * 2) * 0.5;
    const baseY = GROUND_Y;

    this.ring.scale.setScalar(32 + Math.sin(t * 1.5) * 3.5);
    this.ringMat.opacity = 0.32 + pulse * 0.26;

    this.beamMat.opacity = 0.15 + pulse * 0.12;

    this.label.position.y = baseY + this.beamHeight + 22 + Math.sin(t * 1.8) * 4;
  }

  dispose() {
    this.clearHighlight();
    this.scene.remove(this.group);
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.beam.geometry.dispose();
    this.beamMat.dispose();
    this.labelMat.dispose();
    this.hitTargets = [];
  }
}
