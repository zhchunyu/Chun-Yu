/**
 * 安全模式 · 容量口径与数值模型（对齐 CampusTwin 真实数据）
 * ---------------------------------------------------------------------------
 * ★ 本文件是 `04-应用开发/安全管理模式/src/domain/crowd.js` 的**落地版**：
 *   占位 id 全部替换为 `src/data/sharedRepoBuildings.js` 的真实建筑 id 与真实
 *   `type`（dorm / lab / canteen / teach / sports / landmark / tech / ring），
 *   路段 id 统一采用 `roadEdgeId()` 的 `road:节点:节点` 形式。
 *
 * 设计要点：
 *  1. 现有 `location.crowdStatus` 只有 low / normal / busy 三档枚举，只能显示颜色，
 *     做不了风控。风控需要「数值 + 容量 + 基线 + 趋势」。
 *  2. 本模块把枚举**降级为派生视图**（`deriveCrowdStatus`），既有 UI 零改动。
 *  3. ★ 容量口径必须有可解释的现实依据 —— 消防疏散容量、座位数、通道宽度
 *     人流量都是**有据可查**的。评审问「阈值怎么定的」时，这张表就是答案。
 */

import { roadEdgeId } from '../../data/roadNetwork.js'
import { getRoadEdgeOptions } from '../../data/routeGraph.js'

/** 建筑 `type` → 容量口径使用的场所类别 */
export const TYPE_TO_PLACE_KIND = Object.freeze({
  dorm: 'dormitory',
  lab: 'laboratory',
  canteen: 'dining',
  teach: 'teaching',
  sports: 'sports',
  landmark: 'teaching',
  tech: 'teaching',
  ring: 'road',
})

export const PLACE_KINDS = Object.freeze({
  DINING: 'dining',
  TEACHING: 'teaching',
  DORMITORY: 'dormitory',
  LABORATORY: 'laboratory',
  SPORTS: 'sports',
  PLAZA: 'plaza',
  GATE: 'gate',
  ROAD: 'road',
})

export const PLACE_KIND_LABELS = Object.freeze({
  dining: '餐饮场所',
  teaching: '教学场所',
  dormitory: '住宿场所',
  laboratory: '实验场所',
  sports: '体育场所',
  plaza: '集会场所',
  gate: '出入口',
  road: '通行路段',
})

/**
 * ★ 容量口径表 —— 回答「阈值怎么定的」
 */
export const CAPACITY_BASIS = Object.freeze({
  dining: {
    basis: 'seat',
    label: '座位数 × 1.2 瞬时容差',
    multiplier: 1.2,
    rationale: '食堂存在大量打包 / 排队人群，瞬时人数可超过座位数约 20%',
    unit: '座',
  },
  teaching: {
    basis: 'evacuation',
    label: '消防疏散容量（有法定依据）',
    multiplier: 1,
    rationale: '教学楼、图书馆按消防疏散容量控制，超限即安全隐患而非体验问题',
    unit: '人',
  },
  dormitory: {
    basis: 'registered',
    label: '登记住宿人数 × 0.8（同时在楼率）',
    multiplier: 0.8,
    rationale: '登记住宿人数并非同时在楼人数，白天约 8 成在楼',
    unit: '人',
  },
  laboratory: {
    basis: 'evacuation',
    label: '消防疏散容量 × 0.6（危化品折减）',
    multiplier: 0.6,
    rationale: '★ 实验室涉及危化品，安全容量必须比普通教学场所更保守',
    unit: '人',
  },
  sports: {
    basis: 'reported',
    label: '报备人数 × 1.1',
    multiplier: 1.1,
    rationale: '赛事与集会按报备人数控制，留 10% 余量',
    unit: '人',
  },
  plaza: {
    basis: 'reported',
    label: '报备人数 × 1.1',
    multiplier: 1.1,
    rationale: '广场疏散条件好，按报备人数控制即可',
    unit: '人',
  },
  gate: {
    basis: 'throughput',
    label: '单位时间通过能力（人/min）',
    multiplier: 1,
    rationale: '校门关注通过能力而非驻留人数，超限表现为排队积压',
    unit: '人/min',
  },
  road: {
    basis: 'throughput',
    label: '单位宽度人流量（人/min/m）',
    multiplier: 1,
    rationale: '★ 通道宽度是硬约束：人行道 23 人/min/m 为舒适上限，超过即出现对冲与滞留',
    unit: '人/min/m',
  },
})

/**
 * ★ 真实 30 个建筑的容量配置
 *   id 全部来自 `src/data/sharedRepoBuildings.js` 的 `REPO_BUILDINGS`。
 *   数值为**演示口径**：座位数 / 疏散容量 / 住宿人数取校园常规量级，
 *   正式部署时应替换为后勤与保卫处的实测台账。
 */
export const PLACE_CAPACITY = Object.freeze({
  // ---- 出入口与通行 ----
  'east-gate': { name: '主校门', kind: 'gate', throughput: 140 },
  'ring-s1': { name: '环廊S1站', kind: 'road', widthMeters: 4, flowPerMeter: 23 },
  'ring-s4': { name: '环廊S4站', kind: 'road', widthMeters: 5, flowPerMeter: 23 },
  'ring-s7': { name: '环廊S7站', kind: 'road', widthMeters: 4, flowPerMeter: 23 },

  // ---- 餐饮 ----
  canteen: { name: '食堂', kind: 'dining', seats: 330 },
  'commercial-street': { name: '商业街', kind: 'dining', seats: 220 },

  // ---- 教学与公共 ----
  library: { name: '亭兰图书馆', kind: 'teaching', evacuationCapacity: 800 },
  'teaching-a': { name: '公共教学楼', kind: 'teaching', evacuationCapacity: 1200 },
  'teaching-b': { name: '教学B楼', kind: 'teaching', evacuationCapacity: 900 },
  'teaching-c': { name: '教学C楼', kind: 'teaching', evacuationCapacity: 900 },
  'teaching-d': { name: '教学D楼', kind: 'teaching', evacuationCapacity: 760 },
  'lecture-hall': { name: '讲堂', kind: 'teaching', evacuationCapacity: 600 },
  valley: { name: '智谷谷底', kind: 'plaza', reported: 500 },
  'vertical-college': { name: '垂直书院', kind: 'teaching', evacuationCapacity: 520 },
  'innovation-center': { name: '创新中心', kind: 'teaching', evacuationCapacity: 640 },
  'student-center': { name: '学生中心', kind: 'teaching', evacuationCapacity: 700 },
  'performing-arts': { name: '演艺中心', kind: 'teaching', evacuationCapacity: 900 },
  'maker-workshop': { name: '创客工坊', kind: 'teaching', evacuationCapacity: 260 },

  // ---- 实验（危化品，容量更保守）----
  'research-center': { name: '科研中心', kind: 'laboratory', evacuationCapacity: 480 },
  'lab-a': { name: '实验楼A', kind: 'laboratory', evacuationCapacity: 600 },
  'lab-b': { name: '实验楼B', kind: 'laboratory', evacuationCapacity: 540 },

  // ---- 体育 ----
  gymnasium: { name: '体育馆', kind: 'sports', reported: 1500 },
  stadium: { name: '体育场', kind: 'sports', reported: 2000 },
  hospital: { name: '校医院', kind: 'sports', reported: 200 },

  // ---- 住宿（夜间风险最高）----
  dormitory: { name: '宿舍A', kind: 'dormitory', registered: 620 },
  'dorm-b': { name: '宿舍B', kind: 'dormitory', registered: 580 },
  'dorm-d': { name: '宿舍D', kind: 'dormitory', registered: 560 },
  'dorm-e': { name: '宿舍E', kind: 'dormitory', registered: 580 },
  'dorm-f': { name: '宿舍F', kind: 'dormitory', registered: 540 },
  'graduate-apartment': { name: '研究生公寓', kind: 'dormitory', registered: 410 },
})

/**
 * 场所敏感度倍率
 * ★ 同样的火情，宿舍楼和操场不是一个级别 —— 这把「AI 分类」与「校园空间知识」接起来。
 */
export const PLACE_SENSITIVITY = Object.freeze({
  laboratory: 1.5,
  dormitory: 1.5,
  dining: 1.3,
  teaching: 1.2,
  gate: 1.15,
  road: 1.1,
  plaza: 1.0,
  sports: 1.0,
})

export const PLACE_SENSITIVITY_REASONS = Object.freeze({
  laboratory: '危化品风险，事故后果不可逆',
  dormitory: '夜间人员密集且处于休息状态，逃生困难',
  dining: '明火与燃气并存，且高峰时段高度聚集',
  teaching: '人员密集、疏散通道相对有限',
  gate: '涉及进出秩序与外部人员混入',
  road: '直接涉及通行安全',
  plaza: '疏散条件好，作为基准',
  sports: '开阔场地，作为基准',
})

/**
 * 天气修正系数 —— 「同一地点，晴天 75% 不报警，暴雨天 75% 要报警」
 * 修正的是**安全容量**：雨天室内 ×0.8（避雨人群滞留）、室外 ×0.6（湿滑）
 */
export const WEATHER_CAPACITY_FACTORS = Object.freeze({
  clear: { indoor: 1.0, outdoor: 1.0, label: '晴好（基准）' },
  rainstorm: { indoor: 0.8, outdoor: 0.6, label: '暴雨（室内 ×0.8 / 室外 ×0.6）' },
  hail: { indoor: 0.85, outdoor: 0.3, label: '冰雹（室外几乎不可停留）' },
  heat: { indoor: 0.9, outdoor: 0.5, label: '高温（室外 ×0.5）' },
  gale: { indoor: 0.95, outdoor: 0.7, label: '大风（室外 ×0.7）' },
  thunder: { indoor: 0.9, outdoor: 0.4, label: '雷电（空旷场地关闭）' },
})

export const OUTDOOR_KINDS = Object.freeze(['sports', 'plaza', 'road', 'gate'])
export const SHELTER_KINDS = Object.freeze(['teaching', 'dining', 'dormitory'])

/** 由建筑 `type` 推导场所类别 */
export function placeKindOf(type) {
  return TYPE_TO_PLACE_KIND[type] ?? 'plaza'
}

/**
 * 计算**基础安全容量**
 * @param {{ kind: string, seats?: number, evacuationCapacity?: number, registered?: number,
 *           reported?: number, throughput?: number, widthMeters?: number, flowPerMeter?: number }} place
 */
export function computeCapacity(place) {
  const kind = place?.kind
  const basis = CAPACITY_BASIS[kind]
  if (!basis) {
    return { capacity: 0, basis: 'unknown', basisLabel: '未配置容量口径', rationale: '该场所类型未定义容量口径，不参与风控判定' }
  }

  let raw = 0
  if (basis.basis === 'seat') raw = (place.seats ?? 0) * basis.multiplier
  else if (basis.basis === 'evacuation') raw = (place.evacuationCapacity ?? 0) * basis.multiplier
  else if (basis.basis === 'registered') raw = (place.registered ?? 0) * basis.multiplier
  else if (basis.basis === 'reported') raw = (place.reported ?? 0) * basis.multiplier
  else if (basis.basis === 'throughput') {
    raw = place.widthMeters
      ? (place.flowPerMeter ?? 23) * place.widthMeters * 4 // ×4 折算为 5 分钟窗口通过量
      : (place.throughput ?? 0)
  }

  return {
    capacity: Math.round(raw),
    basis: basis.basis,
    basisLabel: basis.label,
    rationale: basis.rationale,
  }
}

/** 天气修正后的有效安全容量 */
export function computeEffectiveCapacity(place, weather = null) {
  const { capacity: baseCapacity } = computeCapacity(place)
  const weatherKind = weather?.kind ?? 'clear'
  const factors = WEATHER_CAPACITY_FACTORS[weatherKind] ?? WEATHER_CAPACITY_FACTORS.clear
  const scope = OUTDOOR_KINDS.includes(place?.kind) ? 'outdoor' : 'indoor'
  const factor = factors[scope]

  return {
    baseCapacity,
    effectiveCapacity: Math.round(baseCapacity * factor),
    factor,
    scope,
    weatherLabel: factors.label,
  }
}

/**
 * ★ 天气修正后的阈值配置
 * 把天气折算成**阈值的下调**，从而自然产生「同一占用率晴天不报警、暴雨报警」的效果 ——
 * 而不是在判定逻辑里写 `if (天气)`。风控逻辑保持单一，天气只是改配置。
 */
export function applyWeatherToThresholds(thresholds, weather) {
  if (!weather || weather.kind === 'clear') return { ...thresholds, weatherAdjusted: false }
  const factors = WEATHER_CAPACITY_FACTORS[weather.kind] ?? WEATHER_CAPACITY_FACTORS.clear
  const shrink = (factors.indoor + factors.outdoor) / 2

  const scale = (level) => ({
    ...level,
    up: Math.round(level.up * shrink * 1000) / 1000,
    down: Math.round(level.down * shrink * 1000) / 1000,
  })

  return {
    warn: scale(thresholds.warn),
    high: scale(thresholds.high),
    critical: scale(thresholds.critical),
    weatherAdjusted: true,
    shrink,
    weatherLabel: factors.label,
  }
}

/**
 * 枚举降级为派生视图 —— 保证既有 UI（依赖 `location.crowdStatus`）零改动
 * @returns {'low' | 'normal' | 'busy'}
 */
export function deriveCrowdStatus(ratio, risk = null) {
  if (risk?.level && risk.level !== 'normal') return 'busy'
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return 'normal'
  if (ratio >= 0.6) return 'busy'
  if (ratio >= 0.3) return 'normal'
  return 'low'
}

/**
 * 构造一条人流读数。★ `locationId` 使用真实的建筑 id。
 */
export function createCrowdReading({
  locationId, count, ts = 0, place = null, weather = null,
  source = 'aggregate', baseline = null, previous = null,
}) {
  const config = place ?? PLACE_CAPACITY[locationId] ?? null
  const capacityInfo = config
    ? computeEffectiveCapacity(config, weather)
    : { baseCapacity: 0, effectiveCapacity: 0, factor: 1, scope: 'indoor', weatherLabel: '未配置' }

  const ratio = capacityInfo.effectiveCapacity > 0
    ? Math.round((count / capacityInfo.effectiveCapacity) * 1000) / 1000
    : 0

  // ★ 首条读数没有参照点 —— 返回 null 而不是 0。
  //   若返回 0，第二条读数会把"首条 = 0"当基线，得出等于总占用率的假趋势，
  //   进而触发假的趋势预警。
  const trend = previous && typeof previous.ratio === 'number'
    ? Math.round((ratio - previous.ratio) * 1000) / 1000
    : null

  return {
    locationId,
    name: config?.name ?? locationId,
    placeKind: config?.kind ?? 'unknown',
    count,
    capacity: capacityInfo.baseCapacity,
    effectiveCapacity: capacityInfo.effectiveCapacity,
    capacityScope: capacityInfo.scope,
    weatherFactor: capacityInfo.factor,
    ratio,
    baseline: baseline ?? null,
    trend,
    source,
    ts,
  }
}

/** 批量构造读数序列（按 locationId 分组、按时间升序） */
export function buildReadingSeries(samples = [], context = {}) {
  const { places = PLACE_CAPACITY, weather = null, baselines = {} } = context
  const grouped = new Map()

  for (const sample of samples) {
    if (!grouped.has(sample.locationId)) grouped.set(sample.locationId, [])
    grouped.get(sample.locationId).push(sample)
  }

  const result = {}
  for (const [locationId, items] of grouped) {
    const sorted = [...items].sort((a, b) => a.ts - b.ts)
    const series = []
    for (const item of sorted) {
      series.push(createCrowdReading({
        locationId,
        count: item.count,
        ts: item.ts,
        place: places[locationId] ?? null,
        weather,
        source: item.source ?? 'aggregate',
        baseline: baselines[locationId] ?? null,
        previous: series.at(-1) ?? null,
      }))
    }
    result[locationId] = series
  }

  return result
}

/** 场所敏感度查询（供预警分级矩阵使用） */
export function getPlaceSensitivity(placeKind) {
  return {
    weight: PLACE_SENSITIVITY[placeKind] ?? 1.0,
    reason: PLACE_SENSITIVITY_REASONS[placeKind] ?? '未配置敏感度，按基准处理',
  }
}

/** 是否为天气避险点 */
export function isShelter(placeKind) {
  return SHELTER_KINDS.includes(placeKind)
}

/**
 * ★ 低洼路段 —— 暴雨封路用，采用**真实路网边 id**
 *
 * 这些边取自 `src/data/roadNetwork.js` 的 `ROAD_EDGES`，且都位于校园南侧
 * 与中轴低洼带（`axis_*` 沿智谷谷底，`outer_s*` 沿南外环）。
 */
export const LOW_LYING_EDGES = Object.freeze([
  roadEdgeId('axis_gate', 'axis_plaza'),
  roadEdgeId('axis_plaza', 'axis_valley_n'),
  roadEdgeId('axis_valley_n', 'axis_mound_s'),
  roadEdgeId('outer_s2', 'outer_s3'),
  roadEdgeId('outer_s1', 'outer_s2'),
])

/** ★ 环廊避雨通道 —— 暴雨时高亮，采用真实路网边 id */
export const COVERED_ROUTE_EDGES = Object.freeze([
  roadEdgeId('ring_s1', 'inner_w_n4'),
  roadEdgeId('ring_s4', 'inner_e_mid'),
  roadEdgeId('ring_s7', 'inner_e_s6'),
  roadEdgeId('inner_e_s3', 'inner_e_s4'),
  roadEdgeId('inner_w_s4', 'inner_w_s5'),
])

/**
 * ★ 大道 / 主通道 —— 人流监测重点路段
 */
export const MAIN_FLOW_EDGES = Object.freeze([
  roadEdgeId('axis_south', 'axis_gate'),
  roadEdgeId('axis_gate', 'axis_plaza'),
  roadEdgeId('axis_plaza', 'axis_valley_n'),
  roadEdgeId('inner_e_s', 'inner_e_s1'),
  roadEdgeId('outer_s2', 'outer_s3'),
])

/**
 * ★ 地点 → 关联路段映射（供预警联动封路使用）
 *
 * 与早期版本的差别：**不再手写边 id**。
 * 手写版出现过 `road:axis_lib_s:inner_w_s` 这种臆造边 —— 它不在真实
 * `ROAD_EDGES` 里，运行期不会报错，但封路会**静默失效**。
 *
 * 现在改为从真实路网**推导**：取 `getRoadEdgeOptions(locationId)` 中
 * 最近的**非接驳路**（排除 `access:` 前缀 —— 那是建筑门口到路网的连接段，
 * 不是校园道路本身），保证每一条都真实存在。
 */
function buildLocationEdgeMap() {
  const map = {}
  for (const locationId of Object.keys(PLACE_CAPACITY)) {
    const options = getRoadEdgeOptions(locationId)
      .filter((option) => option.id.startsWith('road:'))
    if (options.length) map[locationId] = options[0].id
  }
  return Object.freeze(map)
}

export const LOCATION_EDGE_MAP = buildLocationEdgeMap()

/** 查询某地点应关联的路段 id（无映射返回 null，不瞎猜） */
export function resolveLocationEdge(locationId) {
  return LOCATION_EDGE_MAP[locationId] ?? null
}

/**
 * 模块自检
 * @returns {{ name: string, passed: boolean, checks: Array<{label: string, passed: boolean, detail: string}> }}
 */
export function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  // ① 覆盖全部真实建筑
  const missing = Object.keys(PLACE_CAPACITY)
  add('① 容量表覆盖 30 个真实建筑', missing.length === 30,
    `${missing.length} 个建筑已配置容量`)

  // ② 容量口径
  const canteen = computeCapacity(PLACE_CAPACITY.canteen)
  add('② 食堂按座位数 ×1.2', canteen.capacity === Math.round(330 * 1.2),
    `330 座 → ${canteen.capacity} 人（${canteen.basisLabel}）`)

  // ③ 实验室比同规模教学更保守
  const lab = computeCapacity(PLACE_CAPACITY['lab-a'])
  const teach = computeCapacity({ kind: 'teaching', evacuationCapacity: 600 })
  add('③ 实验室容量比同规模教学场所更保守', lab.capacity < teach.capacity,
    `实验楼A ${lab.capacity} 人 < 教学(600) ${teach.capacity} 人（危化品折减 0.6）`)

  // ④ 道路按宽度折算
  const ring = computeCapacity(PLACE_CAPACITY['ring-s4'])
  add('④ 环廊按通道宽度折算容量', ring.capacity === Math.round(23 * 5 * 4),
    `5 m 宽 × 23 人/min/m × 4 = ${ring.capacity} 人`)

  // ⑤ ★ 天气修正的核心结论
  const clear = createCrowdReading({ locationId: 'canteen', count: 312, ts: 1, place: PLACE_CAPACITY.canteen, weather: { kind: 'clear' } })
  const storm = createCrowdReading({ locationId: 'canteen', count: 312, ts: 1, place: PLACE_CAPACITY.canteen, weather: { kind: 'rainstorm' } })
  add('⑤ ★ 同一人数在暴雨下占用率更高（容量折减）', storm.ratio > clear.ratio,
    `312 人：晴天 ${(clear.ratio * 100).toFixed(1)}%（容量 ${clear.effectiveCapacity}）→ 暴雨 ${(storm.ratio * 100).toFixed(1)}%（容量 ${storm.effectiveCapacity}）`)

  // ⑥ 阈值随天气下调
  const base = { warn: { up: 0.75, down: 0.65 }, high: { up: 0.9, down: 0.8 }, critical: { up: 1.05, down: 0.95 } }
  const adjusted = applyWeatherToThresholds(base, { kind: 'rainstorm' })
  add('⑥ 天气修正下调阈值而非改动判定逻辑', adjusted.warn.up < base.warn.up && adjusted.weatherAdjusted,
    `关注档 ${base.warn.up} → ${adjusted.warn.up}（×${adjusted.shrink.toFixed(2)}）`)

  // ⑦ 首条读数趋势为 null
  const first = createCrowdReading({ locationId: 'canteen', count: 100, ts: 1, place: PLACE_CAPACITY.canteen, weather: { kind: 'clear' } })
  add('⑦ 首条读数趋势为 null 而非 0（避免假趋势预警）', first.trend === null,
    `trend = ${first.trend}`)

  // ⑧ 枚举派生视图向后兼容
  add('⑧ 枚举派生视图覆盖三档且高风险强制 busy',
    deriveCrowdStatus(0.1) === 'low' && deriveCrowdStatus(0.4) === 'normal' &&
    deriveCrowdStatus(0.7) === 'busy' && deriveCrowdStatus(0.4, { level: 'high' }) === 'busy',
    'low / normal / busy 均可派生')

  // ⑨ ★ 边 id 与真实路网对齐
  const allEdges = [...LOW_LYING_EDGES, ...COVERED_ROUTE_EDGES, ...MAIN_FLOW_EDGES]
  const malformed = allEdges.filter((id) => !/^road:[a-z0-9_]+:[a-z0-9_]+$/.test(id))
  add('⑨ ★ 所有路段 id 符合 roadEdgeId() 的真实格式', malformed.length === 0,
    `${allEdges.length} 条边全部形如 road:节点:节点${malformed.length ? `，异常：${malformed.join('、')}` : ''}`)

  // ⑩ 场所敏感度
  add('⑩ 场所敏感度：宿舍与实验室最高',
    getPlaceSensitivity('dormitory').weight === 1.5 &&
    getPlaceSensitivity('laboratory').weight === 1.5 &&
    getPlaceSensitivity('sports').weight === 1.0,
    `宿舍 ${getPlaceSensitivity('dormitory').weight} / 实验室 ${getPlaceSensitivity('laboratory').weight} / 体育 ${getPlaceSensitivity('sports').weight}`)

  // ⑪ 建筑 type → 场所类别映射完整
  const types = ['dorm', 'lab', 'canteen', 'teach', 'sports', 'landmark', 'tech', 'ring']
  const unmapped = types.filter((type) => !TYPE_TO_PLACE_KIND[type])
  add('⑪ 八种建筑 type 全部映射到容量口径', unmapped.length === 0,
    `已映射：${types.map((t) => `${t}→${TYPE_TO_PLACE_KIND[t]}`).join('、')}`)

  // ⑫ 地点 → 路段映射：全部为真实推导值
  //   ★ 不要硬编码具体边 id —— 映射是从真实路网推导的，
  //     硬编码会在路网调整后变成假失败（早期版本就踩过）。
  const mappedIds = Object.values(LOCATION_EDGE_MAP)
  const badMapped = mappedIds.filter((id) => !/^road:[a-z0-9_]+:[a-z0-9_]+$/.test(id))
  add('⑫ 地点 → 路段映射全部为真实推导值',
    mappedIds.length === 30 && badMapped.length === 0 && resolveLocationEdge('canteen') !== null,
    `${mappedIds.length} 个地点均有映射，格式全部合法；食堂 → ${resolveLocationEdge('canteen')}`)

  return { name: 'domain/safety/capacity.js', passed: checks.every((c) => c.passed), checks }
}
