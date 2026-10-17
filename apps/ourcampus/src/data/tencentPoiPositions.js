// 腾讯实测坐标表（每个建筑一个精确点，GCJ-02）
//
// 数据来源（四批，都是「实测点」）：
//   ① 腾讯地图 WebService 接口（逆地址解析 result.pois / 地点搜索）实测 ——
//      由 `tools/harvest-tencent-poi.mjs` 采集，与官方 POI 严格同源
//      （西校门/牌楼/崇学楼/教学主楼/实验大楼/勤学楼 与官方 POI 误差 ≤2 m）。
//   ② 腾讯 JS API GL 底图「点击实测」2026-10-11 第一批 —— 东侧宿舍列 11–20 号。
//      相邻楼栋实测间距 35.3–38.0 m，非常均匀，可确认点击一致、数据可用于严格标定。
//   ③ 腾讯 JS API GL 底图「点击实测」2026-10-11 第二批 —— 中西部建筑 + 中部宿舍
//      1/2/3/6/7 号 + 图书馆/西校门/新北门等地标，共 19 个点。
//   ④ 腾讯 JS API GL 底图「点击实测」2026-10-11 第三批 —— 体育与服务设施、
//      教学管理楼、汇文楼/思源楼等，共 20 个点（含 5 个新收录地物）。
//
// ★ 独立交叉验证：负责人点击值与腾讯 POI 库已有权威坐标的吻合度 ——
//   2号公寓楼 5.8 m、生命科学学院 4.0 m、动物医学学院 24 m，说明点击精度足够。
//
// ★ 为什么需要这张表：官方校园引导图是手绘示意图，南北比例尺约比东西大 1.5 倍，
//   用「图像像素 → 经纬度」的全局仿射换算时误差会沿南北方向累积。校正前实测差值：
//   东侧宿舍列北端 18 号偏 25 m，南端 11 号偏 115 m、19 号偏 130 m；
//   中西部建筑偏 20–120 m；`veterinary-center` 因引导图定位错误偏达 513 m。
//   凡登记在此的建筑一律直接使用实测坐标，标注中心与建筑中心严格重合。
// ★ 未登记的建筑退回「仿射 + 控制点残差校正」（见 tencentCampusGeo.js），精度次之。
export const TENCENT_POI_POSITIONS = Object.freeze({
  // ── 出入口与地标 ──────────────────────────────────────────────
  'east-gate': { lat: 37.424644, lng: 112.578277 },
  'new-north-gate': { lat: 37.423424, lng: 112.590202 },
  paifang: { lat: 37.424444, lng: 112.579655 },
  library: { lat: 37.423444, lng: 112.580221 },
  'ming-lake': { lat: 37.422510, lng: 112.581688 },

  // ── 教学与科研楼 ──────────────────────────────────────────────
  'teaching-a': { lat: 37.425144, lng: 112.583579 },
  'main-teaching-building': { lat: 37.423786, lng: 112.585820 },
  'lab-building': { lat: 37.424905, lng: 112.581233 },
  'qinxue-building': { lat: 37.423319, lng: 112.578307 },
  'chongshi-building': { lat: 37.421467, lng: 112.580088 },
  'chongxin-building': { lat: 37.423697, lng: 112.586949 },
  'hanshi-building': { lat: 37.424625, lng: 112.581999 },
  'tianshi-building': { lat: 37.424500, lng: 112.582745 },
  'resource-environment-college': { lat: 37.422484, lng: 112.578262 },
  'veterinary-center': { lat: 37.425325, lng: 112.581503 },
  'life-sciences-building': { lat: 37.421685, lng: 112.578253 },
  'agricultural-engineering-building': { lat: 37.421487, lng: 112.579114 },
  'teaching-management-building': { lat: 37.423065, lng: 112.583922 },
  'eco-monitoring-center': { lat: 37.422174, lng: 112.581753 },
  'engineering-center': { lat: 37.424928, lng: 112.582676 },
  'food-laboratory': { lat: 37.421277, lng: 112.581858 },
  'smart-greenhouse': { lat: 37.421428, lng: 112.581091 },

  // ── 餐饮 ──────────────────────────────────────────────────────
  canteen: { lat: 37.421839, lng: 112.585868 },
  'yixinyuan-canteen': { lat: 37.421119, lng: 112.585472 },
  'employee-canteen': { lat: 37.424972, lng: 112.580244 },
  'bitaoyuan-canteen': { lat: 37.421582, lng: 112.591557 },

  // ── 体育、场馆与服务设施 ──────────────────────────────────────
  gymnasium: { lat: 37.422410, lng: 112.588506 },
  'sports-ground': { lat: 37.425788, lng: 112.582354 },
  'sports-department': { lat: 37.422431, lng: 112.587886 },
  'ball-court': { lat: 37.421776, lng: 112.589521 },
  'net-court': { lat: 37.422818, lng: 112.589715 },
  'swimming-pool': { lat: 37.421062, lng: 112.587755 },
  'ruizhi-sports-center': { lat: 37.420908, lng: 112.589257 },
  'heat-exchange-station': { lat: 37.420990, lng: 112.586483 },
  'botanical-garden': { lat: 37.421659, lng: 112.583325 },
  'jing-garden': { lat: 37.425207, lng: 112.579132 },
  'guest-house': { lat: 37.425558, lng: 112.580363 },

  // ── 住宿：中部片区 ────────────────────────────────────────────
  'apartment-1': { lat: 37.421151, lng: 112.584584 },
  'apartment-2': { lat: 37.421566, lng: 112.584695 },
  'apartment-3': { lat: 37.422341, lng: 112.584775 },
  'apartment-4': { lat: 37.422701, lng: 112.584870 },
  'apartment-5': { lat: 37.421925, lng: 112.584050 },
  'apartment-6': { lat: 37.422513, lng: 112.585798 },
  'apartment-7': { lat: 37.422863, lng: 112.585863 },
  'apartment-8': { lat: 37.422692, lng: 112.587381 },
  'apartment-9': { lat: 37.422321, lng: 112.587258 },
  'apartment-10': { lat: 37.421154, lng: 112.587140 },

  // ── 住宿：东侧列（由北向南，间距约 36 m）──────────────────────
  'apartment-18': { lat: 37.423075, lng: 112.590815 },
  'apartment-17': { lat: 37.422756, lng: 112.590739 },
  'apartment-16': { lat: 37.422433, lng: 112.590724 },
  'apartment-15': { lat: 37.422094, lng: 112.590660 },
  'apartment-14': { lat: 37.421777, lng: 112.590600 },
  'apartment-13': { lat: 37.421436, lng: 112.590523 },
  'apartment-12': { lat: 37.421105, lng: 112.590489 },
  'apartment-11': { lat: 37.420767, lng: 112.590422 },

  // ── 住宿：更东侧列与北侧片区 ──────────────────────────────────
  'apartment-20': { lat: 37.422789, lng: 112.591941 },
  'apartment-19': { lat: 37.420872, lng: 112.591490 },
  kangxinyuan: { lat: 37.422416, lng: 112.586539 },
  'talent-apartment': { lat: 37.423739, lng: 112.582025 },
  'apartment-22': { lat: 37.426168, lng: 112.580616 },
  'apartment-23': { lat: 37.426138, lng: 112.579833 },
})
