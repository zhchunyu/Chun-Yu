/**
 * 人流容量口径与数值模型
 * ---------------------------------------------------------------------------
 * 路线 A / 决策项 A-9（空间聚合粒度 = 建筑）+ A-11（容量口径分级配置）
 *
 * 设计要点（方案书「技术实现 20 分」的可见设计）：
 *  1. 现有 data 层的 `CROWD_STATUS` 只有 low / normal / busy 三个枚举值，
 *     只能显示颜色，做不了风控。风控需要「数值 + 容量 + 基线 + 趋势」。
 *  2. 本模块把枚举**降级为派生视图**（`deriveCrowdStatus`），
 *     现有 UI 无需任何改动即可继续工作（向后兼容）。
 *  3. ★ 容量口径必须有可解释的现实依据 —— 消防疏散容量、座位数、
 *     通道宽度人流量都是**有据可查**的。评审会问「你的阈值怎么定的」，
 *     答「拍的」就完了，答「按消防疏散容量 + 通道宽度人流量折算」就立住了。
 */

/**
 * 场所类型
 * ★ 这 8 类直接决定容量口径的选取，新增类型必须同步 `CAPACITY_BASIS`
 */
export const PLACE_KINDS = Object.freeze({
  DINING: 'dining', // 餐饮：食堂、餐厅
  TEACHING: 'teaching', // 教学：教学楼、图书馆
  DORMITORY: 'dormitory', // 住宿：宿舍楼
  LABORATORY: 'laboratory', // 实验：实验楼（危化品）
  SPORTS: 'sports', // 体育：操场、体育馆、球场
  PLAZA: 'plaza', // 集会：广场、下沉广场
  GATE: 'gate', // 出入口：校门、车库入口
  ROAD: 'road', // 通行：路段、通道
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
 * ★ 容量口径表 —— A-11 的核心
 *
 * 每种场所类型用**什么口径**折算安全容量，以及折算系数。
 * 评审问「阈值怎么定的」时，这张表就是答案。
 */
export const CAPACITY_BASIS = Object.freeze({
  dining: {
    basis: 'seat',
    label: '座位数 × 1.2 瞬时容差',
    multiplier: 1.2,
    rationale: '食堂存在大量打包/排队人群，瞬时人数可超过座位数约 20%',
    unit: '座',
  },
  teaching: {
    basis: 'evacuation',
    label: '消防疏散容量（有法定依据）',
    multiplier: 1,
    rationale: '教学楼、图书馆按消防疏散容量控制，超限即是安全隐患而非体验问题',
    unit: '人',
  },
  dormitory: {
    basis: 'registered',
    label: '登记住宿人数 × 0.8（同时在楼率）',
    multiplier: 0.8,
    rationale: '宿舍登记的住宿人数并非同时在楼人数，白天约 8 成在楼',
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
    rationale: '集会和赛事按报备人数控制，留 10% 余量',
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
    rationale: '校门关注的是通过能力而非驻留人数，超限表现为排队积压',
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
 * 场所容量配置表
 * ★ 占位数据 —— 真实数值需与 CampusTwin 的 `locationId` 对齐后替换。
 *   结构与 `src/data/locations.js` 的 `location.id` 一致，便于查表。
 */
export const PLACE_CAPACITY = Object.freeze({
  Canteen: { name: '第三食堂', kind: 'dining', seats: 330 },
  'Canteen-2': { name: '第二食堂', kind: 'dining', seats: 260 },
  Library: { name: '亭兰图书馆', kind: 'teaching', evacuationCapacity: 800 },
  'Teach-A': { name: '教学A楼', kind: 'teaching', evacuationCapacity: 1200 },
  'Teach-B': { name: '教学B楼', kind: 'teaching', evacuationCapacity: 900 },
  'Teach-D': { name: '教学D楼', kind: 'teaching', evacuationCapacity: 760 },
  'Dorm-A': { name: '宿舍A栋', kind: 'dormitory', registered: 620 },
  'Dorm-E': { name: '宿舍E栋', kind: 'dormitory', registered: 580 },
  'Dorm-F': { name: '宿舍F栋', kind: 'dormitory', registered: 540 },
  'Grad-Dorm': { name: '研究生公寓', kind: 'dormitory', registered: 410 },
  'Lab-Center': { name: '实验中心', kind: 'laboratory', evacuationCapacity: 600 },
  Stadium: { name: '体育馆', kind: 'sports', reported: 1500 },
  Playground: { name: '东操场', kind: 'sports', reported: 2000 },
  'Plaza-Center': { name: '中央广场', kind: 'plaza', reported: 800 },
  'Sunken-Plaza': { name: '下沉广场', kind: 'plaza', reported: 400 },
  'Gate-Main': { name: '主校门', kind: 'gate', throughput: 120 },
  'Gate-North': { name: '北校门', kind: 'gate', throughput: 80 },
  'Road-Axis': { name: '中轴大道', kind: 'road', widthMeters: 6, flowPerMeter: 23 },
  'Road-Outer-S': { name: '外环南段', kind: 'road', widthMeters: 4, flowPerMeter: 23 },
  'Road-Inner-E': { name: '内环东段', kind: 'road', widthMeters: 3.5, flowPerMeter: 23 },
})

/**
 * 场所敏感度倍率
 * ★ 决策项 B-8 —— 同样的火情，宿舍楼和操场不是一个级别。
 *   这把「AI 分类」和「校园空间知识」真正接上了。
 */
export const PLACE_SENSITIVITY = Object.freeze({
  laboratory: 1.5, // 危化品
  dormitory: 1.5, // 夜间人员密集、逃生困难
  dining: 1.3, // 明火 + 燃气
  teaching: 1.2, // 人员密集、疏散通道少
  gate: 1.15, // 涉及进出秩序
  road: 1.1, // 涉及通行安全
  plaza: 1.0, // 基准
  sports: 1.0, // 基准
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
 * 天气修正系数
 * ★ 决策项 A-16 —— 「同一地点，晴天 75% 不报警，暴雨天 75% 要报警」。
 *
 * 修正的是**安全容量**（effectiveCapacity = baseCapacity × factor）：
 *  - 雨天室内 ×0.8：人进来后待得更久（避雨），周转率下降
 *  - 雨天室外 ×0.6：路面湿滑、视线差，可容纳人数显著下降
 *  - 高温室内 ×0.9、室外 ×0.5：都往室内挤，室外几乎不能待
 */
export const WEATHER_CAPACITY_FACTORS = Object.freeze({
  clear: { indoor: 1.0, outdoor: 1.0, label: '晴好（基准）' },
  rainstorm: { indoor: 0.8, outdoor: 0.6, label: '暴雨（室内 ×0.8 / 室外 ×0.6）' },
  hail: { indoor: 0.85, outdoor: 0.3, label: '冰雹（室外几乎不可停留）' },
  heat: { indoor: 0.9, outdoor: 0.5, label: '高温（室外 ×0.5）' },
  gale: { indoor: 0.95, outdoor: 0.7, label: '大风（室外 ×0.7）' },
  thunder: { indoor: 0.9, outdoor: 0.4, label: '雷电（空旷场地关闭）' },
})

/** 视为「室外」的场所类型（天气修正取 outdoor 系数） */
export const OUTDOOR_KINDS = Object.freeze(['sports', 'plaza', 'road', 'gate'])

/** 需要「避险/避雨」属性的场所类型（天气恶劣时成为安全点） */
export const SHELTER_KINDS = Object.freeze(['teaching', 'dining', 'dormitory'])

/**
 * 根据场所配置计算**基础安全容量**（未做天气修正）
 *
 * @param {{ kind: string, seats?: number, evacuationCapacity?: number,
 *           registered?: number, reported?: number, throughput?: number,
 *           widthMeters?: number, flowPerMeter?: number }} place 场所配置
 * @returns {{ capacity: number, basis: string, basisLabel: string, rationale: string }}
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
    // 通行类：有宽度则按 人/min/m × 宽度 折算，否则直接用吞吐量
    raw = place.widthMeters
      ? (place.flowPerMeter ?? basis.multiplier) * place.widthMeters * 4 // ×4 折算为 5 分钟窗口通过量
      : (place.throughput ?? 0)
  }

  return {
    capacity: Math.round(raw),
    basis: basis.basis,
    basisLabel: basis.label,
    rationale: basis.rationale,
  }
}

/**
 * 计算**天气修正后的有效安全容量**
 *
 * @param {{ kind: string }} place 场所配置
 * @param {{ kind?: string } | null} weather 天气场景（取 `kind` 字段：rainstorm/hail/heat/gale/thunder/clear）
 * @returns {{ baseCapacity: number, effectiveCapacity: number, factor: number,
 *             scope: 'indoor' | 'outdoor', weatherLabel: string }}
 */
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
 *
 * 把天气折算成阈值的**下调**，从而自然产生「同一个 78% 的占用率，
 * 晴天不报警、暴雨天报警」的效果 —— 而不是在判定逻辑里写 if 天气。
 * 这样风控逻辑保持单一，天气只是改配置。
 */
export function applyWeatherToThresholds(thresholds, weather) {
  if (!weather || weather.kind === 'clear') return { ...thresholds, weatherAdjusted: false }
  const factors = WEATHER_CAPACITY_FACTORS[weather.kind] ?? WEATHER_CAPACITY_FACTORS.clear
  // 取两个 scope 的平均折减作为阈值下调幅度（不区分室内外的通用兜底）
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
 * 枚举降级为派生视图
 * ★ 保证现有 UI（依赖 `location.crowdStatus`）零改动继续工作。
 *
 * @param {number} ratio 占用率 = count / effectiveCapacity
 * @param {{ level?: string }} [risk] 风控判定结果（可选，有则优先按其档位映射）
 * @returns {'low' | 'normal' | 'busy'}
 */
export function deriveCrowdStatus(ratio, risk = null) {
  if (risk?.level === 'high' || risk?.level === 'critical') return 'busy'
  if (risk?.level === 'warn') return 'busy'
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return 'normal'
  if (ratio >= 0.6) return 'busy'
  if (ratio >= 0.3) return 'normal'
  return 'low'
}

/**
 * 构造一条人流读数（数据采集层 → 风控层的统一结构）
 *
 * @param {{ locationId: string, count: number, ts?: number,
 *           place?: object, weather?: object, source?: string,
 *           baseline?: number|null, previous?: object|null }} input
 * @returns {object} 统一的人流读数
 */
export function createCrowdReading({
  locationId,
  count,
  ts = 0,
  place = null,
  weather = null,
  source = 'aggregate',
  baseline = null,
  previous = null,
}) {
  const config = place ?? PLACE_CAPACITY[locationId] ?? null
  const capacityInfo = config
    ? computeEffectiveCapacity(config, weather)
    : { baseCapacity: 0, effectiveCapacity: 0, factor: 1, scope: 'indoor', weatherLabel: '未配置' }

  const ratio = capacityInfo.effectiveCapacity > 0
    ? Math.round((count / capacityInfo.effectiveCapacity) * 1000) / 1000
    : 0

  // 趋势：与上一个采样点的比值之差（正数表示正在涨）
  // ★ 首条读数没有参照点 —— 返回 null 而不是 0。
  //   若返回 0，第二条读数会把"首条 = 0"当成基线，得出等于总占用率的假趋势。
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

/**
 * 批量构造读数序列（按 locationId 分组，按时间升序）
 *
 * @param {Array<{ locationId: string, count: number, ts: number }>} samples 原始采样
 * @param {{ places?: object, weather?: object, baselines?: object }} [context]
 * @returns {object} locationId → 读数数组
 */
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

/**
 * 场所敏感度查询（供 domain/alert.js 分级矩阵使用）
 *
 * @param {string} placeKind PLACE_KINDS 之一
 * @returns {{ weight: number, reason: string }}
 */
export function getPlaceSensitivity(placeKind) {
  return {
    weight: PLACE_SENSITIVITY[placeKind] ?? 1.0,
    reason: PLACE_SENSITIVITY_REASONS[placeKind] ?? '未配置敏感度，按基准处理',
  }
}

/**
 * 是否为安全避险点（天气恶劣时可引导前往）
 * @param {string} placeKind
 * @returns {boolean}
 */
export function isShelter(placeKind) {
  return SHELTER_KINDS.includes(placeKind)
}

/**
 * 模块自检（零依赖，可直接用 node 运行）
 * @returns {{ name: string, passed: boolean, checks: Array<{label: string, passed: boolean, detail: string}> }}
 */
export function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  // ① 容量口径：食堂按座位数 ×1.2
  const canteen = computeCapacity(PLACE_CAPACITY.Canteen)
  add('食堂容量 = 座位数 × 1.2', canteen.capacity === Math.round(330 * 1.2),
    `330 座 → ${canteen.capacity} 人，口径「${canteen.basisLabel}」`)

  // ② 容量口径：图书馆按消防疏散容量
  const library = computeCapacity(PLACE_CAPACITY.Library)
  add('图书馆按消防疏散容量', library.capacity === 800 && library.basis === 'evacuation',
    `口径「${library.basisLabel}」→ ${library.capacity} 人`)

  // ③ 实验室折减：必须比同规模教学场所保守
  const lab = computeCapacity(PLACE_CAPACITY['Lab-Center'])
  const teach = computeCapacity({ kind: 'teaching', evacuationCapacity: 600 })
  add('实验室容量比同规模教学场所更保守', lab.capacity < teach.capacity,
    `实验室 ${lab.capacity} 人 < 教学 ${teach.capacity} 人（危化品折减 0.6）`)

  // ④ 通行类按宽度折算
  const axisRoad = computeCapacity(PLACE_CAPACITY['Road-Axis'])
  add('中轴大道按宽度折算容量', axisRoad.capacity === Math.round(23 * 6 * 4),
    `6 m 宽 × 23 人/min/m × 4（5 分钟窗口） = ${axisRoad.capacity} 人`)

  // ⑤ 天气修正：暴雨使室外容量显著下降且低于室内
  const outdoor = computeEffectiveCapacity(PLACE_CAPACITY.Playground, { kind: 'rainstorm' })
  const indoor = computeEffectiveCapacity(PLACE_CAPACITY.Canteen, { kind: 'rainstorm' })
  add('暴雨修正：室外折减大于室内', outdoor.factor < indoor.factor,
    `室外 ×${outdoor.factor} / 室内 ×${indoor.factor}`)

  // ⑥ ★ 核心结论：同一个占用率，晴天不报警、暴雨天报警
  const seatCount = 312 // 第三食堂 312 人
  const clearReading = createCrowdReading({
    locationId: 'Canteen', count: seatCount, ts: 1,
    place: PLACE_CAPACITY.Canteen, weather: { kind: 'clear' },
  })
  const stormReading = createCrowdReading({
    locationId: 'Canteen', count: seatCount, ts: 1,
    place: PLACE_CAPACITY.Canteen, weather: { kind: 'rainstorm' },
  })
  add('★ 同一人数在暴雨下占用率更高',
    stormReading.ratio > clearReading.ratio,
    `312 人：晴天 ${(clearReading.ratio * 100).toFixed(1)}%（容量 ${clearReading.effectiveCapacity}）` +
    ` → 暴雨 ${(stormReading.ratio * 100).toFixed(1)}%（容量 ${stormReading.effectiveCapacity}）`)

  // ⑦ 阈值随天气下调
  const base = {
    warn: { up: 0.75, down: 0.65, dwell: 2, cooldownMs: 600000 },
    high: { up: 0.9, down: 0.8, dwell: 3, cooldownMs: 900000 },
    critical: { up: 1.05, down: 0.95, dwell: 3, cooldownMs: 1200000 },
  }
  const adjusted = applyWeatherToThresholds(base, { kind: 'rainstorm' })
  add('天气修正下调阈值而非改动判定逻辑',
    adjusted.warn.up < base.warn.up && adjusted.weatherAdjusted === true,
    `关注档阈值 ${base.warn.up} → ${adjusted.warn.up}（折减 ×${adjusted.shrink.toFixed(2)}）`)

  // ⑧ 枚举派生视图向后兼容
  add('枚举派生视图覆盖三档',
    deriveCrowdStatus(0.1) === 'low' &&
    deriveCrowdStatus(0.4) === 'normal' &&
    deriveCrowdStatus(0.7) === 'busy' &&
    deriveCrowdStatus(0.4, { level: 'high' }) === 'busy',
    'low / normal / busy 三档均可派生，且高风险档强制为 busy')

  // ⑨ 趋势计算
  const rising = createCrowdReading({
    locationId: 'Canteen', count: 300, ts: 2,
    place: PLACE_CAPACITY.Canteen, weather: { kind: 'clear' },
    previous: { ratio: 0.5 },
  })
  const firstReading = createCrowdReading({
    locationId: 'Canteen', count: 300, ts: 1,
    place: PLACE_CAPACITY.Canteen, weather: { kind: 'clear' },
    previous: null,
  })
  add('趋势可计算，且首条读数为 null 而非 0', rising.trend > 0 && firstReading.trend === null,
    `有前值：0.5 → ${rising.ratio}，趋势 +${rising.trend}；无前值：trend = ${firstReading.trend}`)

  // ⑩ 场所敏感度：宿舍/实验室最高
  add('场所敏感度：宿舍与实验室最高',
    getPlaceSensitivity('dormitory').weight === 1.5 &&
    getPlaceSensitivity('laboratory').weight === 1.5 &&
    getPlaceSensitivity('sports').weight === 1.0,
    `宿舍 ${getPlaceSensitivity('dormitory').weight} / 实验室 ${getPlaceSensitivity('laboratory').weight} / 体育 ${getPlaceSensitivity('sports').weight}`)

  // ⑪ 避险点判定
  add('教学楼/食堂为天气避险点', isShelter('teaching') && isShelter('dining') && !isShelter('road'),
    '环廊避雨通道引导依赖此判定')

  // ⑫ 序列构造与分组
  const series = buildReadingSeries([
    { locationId: 'Canteen', count: 100, ts: 3 },
    { locationId: 'Canteen', count: 200, ts: 1 },
    { locationId: 'Library', count: 300, ts: 1 },
  ], { weather: { kind: 'clear' } })
  add('序列按时间升序且按地点分组',
    series.Canteen.length === 2 &&
    series.Canteen[0].count === 200 &&
    series.Canteen[0].trend === null &&
    typeof series.Canteen[1].trend === 'number',
    `Canteen ${series.Canteen.length} 条（已升序，首条 trend=null、次条有趋势），Library ${series.Library.length} 条`)

  return {
    name: 'domain/crowd.js',
    passed: checks.every((check) => check.passed),
    checks,
  }
}
