/**
 * 天气数据源适配器 · 安全管理模式（路线 C）数据层
 * 文件：src/data/weatherDataSource.js
 *
 * 【定位】
 * 把「天气从哪来」与「天气怎么用」解耦。上层（weatherActionMap.analyzeWeather / 管理者面板 /
 * 路网联动）只面向本文件给出的**统一场景结构**，不关心数据源等级。
 *
 * 【数据源等级】（对应《安全管理模式_决策清单》§1.1）
 * - L1 实时 API + 后端代理（W1）：前端 → /api/weather → 第三方，API Key 只在服务端。
 *   ★ 本文件不实现、也不允许在前端实现。mode: 'live' 返回占位实现，访问数据即抛错并说明原因。
 * - L2 定时抓取 → 静态 JSON（W2）：服务端每 30 min 抓一次落成 weather.json，前端只读。
 *   接口形态与快照完全一致 —— 后续接入时只需替换 WEATHER_SCENARIOS 的来源，工厂签名一行不动。
 * - L3 预置场景 JSON + 管理者面板一键切换（W3）：**本次交付采用的方案**，即 WEATHER_SCENARIOS。
 *
 * 【合规红线】
 * 本文件（以及任何前端代码）不得出现 API Key，不得出现第三方天气服务 URL。
 * 演示数据必须自我声明：每个场景 isDemo === true，source === '演示场景数据'。
 *
 * 【单位约定】
 * temperature ℃（摄氏度）｜ humidity %（相对湿度百分比）｜ windSpeed m/s（米/秒）
 * precipitation mm/h（毫米/小时）｜ visibility km（公里）
 */

/**
 * 数据源模式常量。
 * 用途：createWeatherSource 的分支开关；也是 UI 上「当前数据源」角标的取值来源。
 * @type {Readonly<{ SNAPSHOT: 'snapshot', LIVE: 'live' }>}
 */
export const WEATHER_SOURCE_MODES = Object.freeze({
  /** L3 预置场景快照：读本地 WEATHER_SCENARIOS，演示默认，永不失败 */
  SNAPSHOT: 'snapshot',
  /** L1 实时接口：本文件只留占位实现，访问即抛错（必须由服务端代理，前端不得直连） */
  LIVE: 'live',
})

/**
 * 预警等级常量（对齐国家气象灾害预警信号四级口径）。
 * 用途：规则匹配（minLevel/maxLevel）、升档降档判定、UI 分色。
 * @type {Readonly<{ BLUE: 'blue', YELLOW: 'yellow', ORANGE: 'orange', RED: 'red' }>}
 */
export const WEATHER_LEVELS = Object.freeze({
  BLUE: 'blue',
  YELLOW: 'yellow',
  ORANGE: 'orange',
  RED: 'red',
})

/**
 * 预警等级中文标签。
 * 用途：预警卡片标题、AI 简报文案拼接。
 * @type {Readonly<Record<'blue'|'yellow'|'orange'|'red', string>>}
 */
export const WEATHER_LEVEL_LABELS = Object.freeze({
  blue: '蓝色预警',
  yellow: '黄色预警',
  orange: '橙色预警',
  red: '红色预警',
})

/**
 * 预警等级的可比较顺序值（数值越大等级越高）。
 * 用途：升档/降档判定（compareWeatherLevel）、规则区间匹配、跨场景取最高等级（复合天气）。
 * ★ 必须保持严格递增，runSelfCheck 会校验。
 * @type {Readonly<Record<'blue'|'yellow'|'orange'|'red', number>>}
 */
export const WEATHER_LEVEL_ORDER = Object.freeze({
  blue: 0,
  yellow: 1,
  orange: 2,
  red: 3,
})

/**
 * 天气类型常量（校园处置预案按类型分流，而非按等级分流）。
 * 用途：weatherActionMap 的规则匹配键；'clear' 表示无风险基线，'composite' 表示多类型叠加。
 * @type {Readonly<Record<string, string>>}
 */
export const WEATHER_KINDS = Object.freeze({
  RAINSTORM: 'rainstorm',
  HAIL: 'hail',
  HEAT: 'heat',
  GALE: 'gale',
  THUNDER: 'thunder',
  CLEAR: 'clear',
})

/**
 * 天气类型中文标签。
 * 用途：摘要句拼接（如「暴雨 + 大风」）；'composite' 只用于复合分析结果，不在预置场景中出现。
 * @type {Readonly<Record<string, string>>}
 */
export const WEATHER_KIND_LABELS = Object.freeze({
  rainstorm: '暴雨',
  hail: '冰雹',
  heat: '高温',
  gale: '大风',
  thunder: '雷电',
  clear: '晴好天气',
  composite: '复合天气',
})

/**
 * 预置场景 id 常量表（避免各处硬编码字符串）。
 * @type {Readonly<Record<string, string>>}
 */
export const WEATHER_SCENARIO_IDS = Object.freeze({
  RAINSTORM_RED: 'rainstorm_red',
  HAIL_ORANGE: 'hail_orange',
  HEAT_ORANGE: 'heat_orange',
  GALE_YELLOW: 'gale_yellow',
  THUNDER_YELLOW: 'thunder_yellow',
  CLEAR: 'clear',
})

/**
 * 默认场景 id：基线取「晴好天气」。
 * 演示叙事：晴好基线 → 切暴雨红警（升档）→ 切回晴好（降档/解除），等级时间线自洽。
 * @type {string}
 */
export const DEFAULT_SCENARIO_ID = WEATHER_SCENARIO_IDS.CLEAR

/**
 * L1 实时接口未接入的说明文案（占位实现的抛错信息）。
 * ★ 文案本身不含任何密钥与第三方 URL：只说「需要服务端代理 /api/weather」。
 * @type {string}
 */
export const LIVE_SOURCE_UNAVAILABLE_REASON =
  'L1 实时接口未接入：需服务端代理 /api/weather 并在服务端持有 API Key，禁止在前端直连第三方天气服务'
  + '（前端不得出现任何密钥或第三方 URL）。演示请使用 L3 预置场景模式（mode: "snapshot"）。'

/**
 * 预置天气场景表（L3 方案主体）：6 个场景，字段结构完全一致。
 *
 * 取值现实依据（每个场景数值均可被追问）：
 * - 国家气象灾害预警信号判据：暴雨红警 = 3 小时降雨量 ≥ 100 mm（折合平均 ≥ 33 mm/h，
 *   短时强降水 50 mm/h 以上属常见量级）；高温橙警 = 24 小时内最高气温 ≥ 37 ℃；
 *   大风黄警 = 12 小时内阵风 8 级以上（≥ 17.2 m/s）；雷电/冰雹预警信号按国家规定只有黄/橙/红三级。
 * - 体感与能见度：强降雨能见度降至 1~2 km（低于高速公路低能见度判据 2 km）；
 *   高温橙警多受副热带高压控制，晴朗少云、相对湿度低（本表取 35 %）。
 *
 * ★ isDemo: true 是硬约束 —— 演示数据必须自我声明，不假装是真实气象数据（决策清单 Y-1）。
 *
 * @type {Readonly<Record<string, Readonly<{
 *   id: string, label: string, icon: string, level: string, kind: string,
 *   temperature: number, humidity: number, windSpeed: number, precipitation: number,
 *   visibility: number, text: string, issuedAt: string, source: string, isDemo: boolean,
 * }>>>}
 */
export const WEATHER_SCENARIOS = Object.freeze({
  // 暴雨红色预警：3 小时 100 mm 量级强降水。24 ℃ 为强对流下沉气流降温后的气温；
  // 湿度 92 % 接近饱和；9.0 m/s 属 5 级劲风（8.0~10.7 m/s），强对流常伴；
  // 62 mm/h 属短时强降水（红警判据量级）；能见度 1.2 km 为强降雨典型值。
  [WEATHER_SCENARIO_IDS.RAINSTORM_RED]: Object.freeze({
    id: 'rainstorm_red',
    label: '暴雨红色预警',
    icon: '🌧️',
    level: 'red',
    kind: 'rainstorm',
    temperature: 24,
    humidity: 92,
    windSpeed: 9.0,
    precipitation: 62,
    visibility: 1.2,
    text: '未来 3 小时内降雨量将达 100 毫米以上',
    issuedAt: '2026-09-28T14:00:00+08:00',
    source: '演示场景数据',
    isDemo: true,
  }),

  // 冰雹橙色预警：冰雹出自强对流积雨云，地面气温多在 15~25 ℃，取 21 ℃；
  // 湿度 78 %（云下层湿、地面未必饱和）；13.0 m/s 属 6 级强风（10.8~13.8 m/s），冰雹常伴下击暴流；
  // 28 mm/h 为伴随的短时强降水；能见度 2.5 km 受降雹与雨幕影响。
  [WEATHER_SCENARIO_IDS.HAIL_ORANGE]: Object.freeze({
    id: 'hail_orange',
    label: '冰雹橙色预警',
    icon: '🧊',
    level: 'orange',
    kind: 'hail',
    temperature: 21,
    humidity: 78,
    windSpeed: 13.0,
    precipitation: 28,
    visibility: 2.5,
    text: '未来 2 小时内可能出现冰雹，并伴有雷电、短时强降水',
    issuedAt: '2026-09-28T15:20:00+08:00',
    source: '演示场景数据',
    isDemo: true,
  }),

  // 高温橙色预警：橙警判据为 24 小时内最高气温 ≥ 37 ℃，取 38 ℃；
  // 副高控制下晴朗少云，相对湿度低（取 35 %）；风力 2.5 m/s 属 2 级轻风（静稳）；
  // 无降水（0 mm/h）；能见度 12 km（午后臭氧/霾可使能见度略低于晴天极值）。
  [WEATHER_SCENARIO_IDS.HEAT_ORANGE]: Object.freeze({
    id: 'heat_orange',
    label: '高温橙色预警',
    icon: '🌡️',
    level: 'orange',
    kind: 'heat',
    temperature: 38,
    humidity: 35,
    windSpeed: 2.5,
    precipitation: 0,
    visibility: 12,
    text: '未来 24 小时内最高气温将升至 37 ℃ 以上',
    issuedAt: '2026-09-28T09:00:00+08:00',
    source: '演示场景数据',
    isDemo: true,
  }),

  // 大风黄色预警：黄警判据为 12 小时内阵风 8 级以上（≥ 17.2 m/s），故取 17.2 m/s；
  // 冷空气过境降温，气温 19 ℃；湿度 55 %；锋面过境可伴零星小雨 3 mm/h；
  // 能见度 6 km 受扬尘影响。
  [WEATHER_SCENARIO_IDS.GALE_YELLOW]: Object.freeze({
    id: 'gale_yellow',
    label: '大风黄色预警',
    icon: '🌬️',
    level: 'yellow',
    kind: 'gale',
    temperature: 19,
    humidity: 55,
    windSpeed: 17.2,
    precipitation: 3,
    visibility: 6,
    text: '未来 12 小时内平均风力可达 8 级以上，阵风 9 级',
    issuedAt: '2026-09-28T11:30:00+08:00',
    source: '演示场景数据',
    isDemo: true,
  }),

  // 雷电黄色预警：雷雨前闷热，气温 27 ℃；湿度 70 %；6.0 m/s 属 4 级和风（5.5~7.9 m/s）；
  // 8 mm/h 为雷阵雨量级；能见度 5 km。
  [WEATHER_SCENARIO_IDS.THUNDER_YELLOW]: Object.freeze({
    id: 'thunder_yellow',
    label: '雷电黄色预警',
    icon: '⚡',
    level: 'yellow',
    kind: 'thunder',
    temperature: 27,
    humidity: 70,
    windSpeed: 6.0,
    precipitation: 8,
    visibility: 5,
    text: '未来 6 小时内可能发生雷电活动，并伴有短时强降水、局地大风',
    issuedAt: '2026-09-28T16:10:00+08:00',
    source: '演示场景数据',
    isDemo: true,
  }),

  // 晴好天气（基线对照）：无生效预警，故 level 取最低档 blue 作为「无预警基线」，
  // 这样 compareWeatherLevel 仍可比较（blue → red 为升档，red → blue 为降档/解除）。
  // 26 ℃ / 湿度 45 % / 2.0 m/s 属 2 级轻风 / 无降水 / 能见度 20 km（优良）。
  [WEATHER_SCENARIO_IDS.CLEAR]: Object.freeze({
    id: 'clear',
    label: '晴好天气',
    icon: '☀️',
    level: 'blue',
    kind: 'clear',
    temperature: 26,
    humidity: 45,
    windSpeed: 2.0,
    precipitation: 0,
    visibility: 20,
    text: '晴，能见度良好，无生效中的气象预警',
    issuedAt: '2026-09-28T08:00:00+08:00',
    source: '演示场景数据',
    isDemo: true,
  }),
})

/** 内部：判断常量表是否含有某个 key（避免 Object.prototype 污染误判） */
const hasKey = (table, key) => Object.prototype.hasOwnProperty.call(table, key)

/** 内部：全部预置场景 id 列表 */
const scenarioIds = () => Object.keys(WEATHER_SCENARIOS)

/** 内部：把等级字符串归一化为顺序值；非法等级直接抛错（快速失败优于静默错算） */
const levelOrderOf = (level) => {
  const order = hasKey(WEATHER_LEVEL_ORDER, level) ? WEATHER_LEVEL_ORDER[level] : null
  if (order === null) {
    throw new Error(`未知预警等级：${String(level)}（合法值：${Object.keys(WEATHER_LEVEL_ORDER).join(' / ')}）`)
  }
  return order
}

/** 内部：从等级或含 level 字段的对象中取出等级字符串 */
const readLevel = (value) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.level === 'string') return value.level
  throw new Error('compareWeatherLevel 需要预警等级字符串，或含 level 字段的对象（场景 / 分析结果）')
}

/** 内部：把 now 归一化为 Date；非法时间抛错 */
const resolveDate = (now) => {
  const value = typeof now === 'function' ? now() : now ?? new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`无法解析时间：${String(value)}`)
  return date
}

/**
 * 比较两个预警等级的相对变化方向。
 *
 * @param {string|{ level: string }} a 变化前的等级（等级字符串，或含 level 的场景 / 分析对象）
 * @param {string|{ level: string }} b 变化后的等级
 * @returns {'up'|'down'|'same'} b 相对 a 的方向：'up' 升档（如 yellow→red）、'down' 降档/解除（如 red→blue）、'same' 不变
 * @throws {Error} 等级取值非法时抛出，避免把「未知等级」静默当成同一档
 */
export function compareWeatherLevel(a, b) {
  const fromOrder = levelOrderOf(readLevel(a))
  const toOrder = levelOrderOf(readLevel(b))
  if (toOrder > fromOrder) return 'up'
  if (toOrder < fromOrder) return 'down'
  return 'same'
}

/**
 * 内部：构造 L1 实时接口的占位实现（数据访问即抛错，绝不静默返回假数据）。
 * ★ 前端拿不到任何真实请求路径，也永远不需要持有 API Key。
 * @param {string} reason 抛错文案
 */
function createLiveWeatherSource(reason) {
  const unavailable = () => {
    const error = new Error(reason)
    error.code = 'WEATHER_LIVE_UNAVAILABLE'
    throw error
  }

  return {
    /** 数据源模式：'live'（占位） */
    mode: WEATHER_SOURCE_MODES.LIVE,
    /** 是否可用：恒为 false，UI 应据此显示「实时源未接入」角标 */
    available: false,
    /** 不可用原因（可直接展示） */
    unavailableReason: reason,
    /** 实时源不可用，取当前天气直接抛错 */
    getCurrent: unavailable,
    /** 实时源不可用，取预警列表直接抛错 */
    getAlerts: unavailable,
    /** 实时源无预置场景可列，返回空数组（UI 可渲染「无可用场景」） */
    listScenarios: () => Object.freeze([]),
    /** 实时源不可切换场景：抛错并指向服务端代理方案 */
    setScenario: unavailable,
    /** 无数据可推送：只登记订阅关系，返回取消订阅函数（不会立刻回调） */
    subscribe(fn) {
      if (typeof fn !== 'function') throw new Error('subscribe 需要一个函数作为监听器')
      return () => {}
    },
    /** 实时源无切换历史，返回空数组 */
    history: () => Object.freeze([]),
  }
}

/**
 * 创建天气数据源（工厂）。
 *
 * 用途：演示与上层逻辑的唯一取数入口 —— 上层不关心数据来自 L1/L2/L3。
 * @param {object} [options] 配置
 * @param {'snapshot'|'live'} [options.mode='snapshot'] 数据源模式；'snapshot' = L3 预置场景，'live' = L1 占位（访问即抛错）
 * @param {string} [options.initialScenarioId='clear'] 初始场景 id（仅 snapshot 模式有效）
 * @param {() => (Date|string|number)} [options.now] 时钟注入，便于演示时间线与自检可复现；默认取系统当前时间
 * @returns {{
 *   mode: string, available: boolean, unavailableReason?: string,
 *   getCurrent: () => object,
 *   getAlerts: () => ReadonlyArray<object>,
 *   listScenarios: () => ReadonlyArray<object>,
 *   setScenario: (id: string) => object,
 *   subscribe: (fn: (scenario: object) => void) => (() => void),
 *   history: () => ReadonlyArray<{ at: string, fromLevel: string, toLevel: string, scenarioId: string, direction: 'up'|'down'|'same' }>,
 * }}
 * @throws {Error} mode 非法、initialScenarioId 不存在时抛出
 */
export function createWeatherSource({
  mode = WEATHER_SOURCE_MODES.SNAPSHOT,
  initialScenarioId = DEFAULT_SCENARIO_ID,
  now,
} = {}) {
  if (mode === WEATHER_SOURCE_MODES.LIVE) return createLiveWeatherSource(LIVE_SOURCE_UNAVAILABLE_REASON)

  if (mode !== WEATHER_SOURCE_MODES.SNAPSHOT) {
    throw new Error(
      `未知天气数据源模式：${String(mode)}`
      + `（合法值：${WEATHER_SOURCE_MODES.SNAPSHOT} / ${WEATHER_SOURCE_MODES.LIVE}）`,
    )
  }

  if (!hasKey(WEATHER_SCENARIOS, initialScenarioId)) {
    throw new Error(`未知天气场景 id：${String(initialScenarioId)}（可用：${scenarioIds().join(' / ')}）`)
  }

  let currentId = initialScenarioId
  const listeners = new Set()
  const records = []

  /** 取当前场景（已冻结对象，可直接交给 UI 渲染） */
  const getCurrent = () => WEATHER_SCENARIOS[currentId]

  /** 取当前预警列表：晴好天气（kind === 'clear'）返回空数组，其余返回 1 条标准预警条目 */
  const getAlerts = () => {
    const scenario = WEATHER_SCENARIOS[currentId]
    if (scenario.kind === WEATHER_KINDS.CLEAR) return Object.freeze([])

    return Object.freeze([
      Object.freeze({
        id: `${scenario.id}:${scenario.issuedAt}`,
        scenarioId: scenario.id,
        kind: scenario.kind,
        level: scenario.level,
        levelOrder: WEATHER_LEVEL_ORDER[scenario.level],
        label: scenario.label,
        icon: scenario.icon,
        text: scenario.text,
        issuedAt: scenario.issuedAt,
        source: scenario.source,
        isDemo: scenario.isDemo,
      }),
    ])
  }

  /** 列出全部可切换场景（管理者面板一键切换用；轻量字段，不含完整气象数值） */
  const listScenarios = () => Object.freeze(scenarioIds().map((id) => {
    const scenario = WEATHER_SCENARIOS[id]
    return Object.freeze({
      id: scenario.id,
      label: scenario.label,
      icon: scenario.icon,
      level: scenario.level,
      levelOrder: WEATHER_LEVEL_ORDER[scenario.level],
      kind: scenario.kind,
      isDemo: scenario.isDemo,
    })
  }))

  /**
   * 切换场景：追加一条升档/降档时间线记录，并通知全部订阅者。
   * ★ 切到同一个场景也会记录一条 direction: 'same'，保证「每次切换都有留痕」。
   */
  const setScenario = (id) => {
    if (!hasKey(WEATHER_SCENARIOS, id)) {
      throw new Error(`未知天气场景 id：${String(id)}（可用：${scenarioIds().join(' / ')}）`)
    }

    const fromLevel = WEATHER_SCENARIOS[currentId].level
    const next = WEATHER_SCENARIOS[id]
    const direction = compareWeatherLevel(fromLevel, next.level)

    currentId = id
    records.push(Object.freeze({
      at: resolveDate(now).toISOString(),
      fromLevel,
      toLevel: next.level,
      scenarioId: next.id,
      direction,
    }))

    listeners.forEach((listener) => listener(next))
    return next
  }

  /** 订阅场景变化：立即回调一次当前场景，返回取消订阅函数 */
  const subscribe = (fn) => {
    if (typeof fn !== 'function') throw new Error('subscribe 需要一个函数作为监听器')
    listeners.add(fn)
    fn(getCurrent())
    return () => listeners.delete(fn)
  }

  /** 取切换历史（升档/降档时间线），返回冻结副本 */
  const history = () => Object.freeze([...records])

  return {
    mode: WEATHER_SOURCE_MODES.SNAPSHOT,
    available: true,
    getCurrent,
    getAlerts,
    listScenarios,
    setScenario,
    subscribe,
    history,
  }
}

/**
 * 模块自检：校验场景数据完整性与数据源机制正确性（不依赖任何外部文件/网络）。
 *
 * @returns {{ name: string, passed: boolean, checks: Array<{ label: string, passed: boolean, detail: string }> }}
 *   name 模块名；passed 全部检查是否通过；checks 逐项检查结果（label 检查项、passed 是否通过、detail 证据）
 */
export function runSelfCheck() {
  const checks = []
  const check = (label, passed, detail) => {
    checks.push({ label, passed: Boolean(passed), detail: String(detail) })
  }
  const safe = (fn) => {
    try {
      return { ok: true, value: fn() }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  // 1. 场景数量与 id 完整性
  const ids = Object.keys(WEATHER_SCENARIOS)
  const requiredIds = [
    'rainstorm_red', 'hail_orange', 'heat_orange', 'gale_yellow', 'thunder_yellow', 'clear',
  ]
  check(
    '预置场景含 5 类预警 + 1 个晴好基线，id 与规范一致',
    ids.length === requiredIds.length && requiredIds.every((id) => ids.includes(id)),
    `实际 ${ids.length} 个：${ids.join(', ')}`,
  )

  // 2. 字段结构一致（6 个场景键集合完全相同）
  const expectedKeys = [
    'id', 'label', 'icon', 'level', 'kind', 'temperature', 'humidity',
    'windSpeed', 'precipitation', 'visibility', 'text', 'issuedAt', 'source', 'isDemo',
  ].join(',')
  const keyMismatch = ids.filter((id) => Object.keys(WEATHER_SCENARIOS[id]).join(',') !== expectedKeys)
  check(
    '全部场景字段结构一致（14 个字段，含结构与单位约定）',
    keyMismatch.length === 0,
    keyMismatch.length ? `字段不一致：${keyMismatch.join(', ')}` : `统一字段：${expectedKeys}`,
  )

  // 3. 演示数据自我声明
  const notDemo = ids.filter((id) => WEATHER_SCENARIOS[id].isDemo !== true || WEATHER_SCENARIOS[id].source !== '演示场景数据')
  check(
    '演示数据自我声明（isDemo === true 且 source 标注演示数据）',
    notDemo.length === 0,
    notDemo.length ? `未声明：${notDemo.join(', ')}` : '6/6 场景均已声明为演示数据',
  )

  // 4. 等级取值合法 + 顺序值严格递增
  const badLevel = ids.filter((id) => !hasKey(WEATHER_LEVEL_ORDER, WEATHER_SCENARIOS[id].level))
  const orderValues = Object.values(WEATHER_LEVEL_ORDER)
  const strictlyIncreasing = orderValues.every((value, index) => index === 0 || value > orderValues[index - 1])
  check(
    '等级取值合法且 WEATHER_LEVEL_ORDER 严格递增（可比较升档/降档）',
    badLevel.length === 0 && strictlyIncreasing,
    badLevel.length
      ? `非法等级：${badLevel.map((id) => `${id}=${WEATHER_SCENARIOS[id].level}`).join(', ')}`
      : `等级序值 ${JSON.stringify(WEATHER_LEVEL_ORDER)} 严格递增`,
  )

  // 5. 物理合理性：高温低湿无雨、暴雨强降水低能见度
  const heat = WEATHER_SCENARIOS.heat_orange
  const rain = WEATHER_SCENARIOS.rainstorm_red
  const clear = WEATHER_SCENARIOS.clear
  const heatSane = heat.humidity < 50 && heat.precipitation === 0 && heat.temperature >= 37
  const rainSane = rain.precipitation >= 50 && rain.visibility <= 2 && rain.humidity >= 90
  check(
    '气象数值物理合理（高温 38℃/湿度 35%/无降水；暴雨 62mm·h⁻¹/能见度 1.2km/湿度 92%）',
    heatSane && rainSane,
    `高温：${heat.temperature}℃ / ${heat.humidity}% / ${heat.precipitation}mm·h⁻¹；`
    + `暴雨：${rain.precipitation}mm·h⁻¹ / ${rain.visibility}km / ${rain.humidity}%`,
  )

  // 6. 物理合理性：大风达黄警阈值、冰雹风力大于雷电、晴天能见度最好
  const galeSane = WEATHER_SCENARIOS.gale_yellow.windSpeed >= 17.2
  const hailVsThunder = WEATHER_SCENARIOS.hail_orange.windSpeed > WEATHER_SCENARIOS.thunder_yellow.windSpeed
  const clearest = ids.every((id) => WEATHER_SCENARIOS[id].visibility <= clear.visibility)
  check(
    '风力/能见度横向自洽（大风 ≥17.2m/s、冰雹风力 > 雷电、晴天能见度最优）',
    galeSane && hailVsThunder && clearest,
    `大风 ${WEATHER_SCENARIOS.gale_yellow.windSpeed}m/s；冰雹 ${WEATHER_SCENARIOS.hail_orange.windSpeed}m/s > 雷电 `
    + `${WEATHER_SCENARIOS.thunder_yellow.windSpeed}m/s；晴好能见度 ${clear.visibility}km 为最大`,
  )

  // 7. 冻结与不可篡改
  const frozen = Object.isFrozen(WEATHER_SCENARIOS)
    && ids.every((id) => Object.isFrozen(WEATHER_SCENARIOS[id]))
    && Object.isFrozen(WEATHER_LEVEL_ORDER)
  // 用 Reflect.set 探测写入是否被拒绝（ESM 恒为严格模式，直接赋值会抛 TypeError）
  const writeAccepted = Reflect.set(WEATHER_SCENARIOS.rainstorm_red, 'level', 'blue')
  check(
    '常量表全部冻结且写入无效（防止运行期被改坏）',
    frozen && writeAccepted === false && WEATHER_SCENARIOS.rainstorm_red.level === 'red',
    `frozen=${frozen}；写入被接受=${writeAccepted}；写入后等级仍为 ${WEATHER_SCENARIOS.rainstorm_red.level}`,
  )

  // 8. compareWeatherLevel 三态
  const upOk = compareWeatherLevel('yellow', 'red') === 'up'
  const downOk = compareWeatherLevel(WEATHER_SCENARIOS.rainstorm_red, WEATHER_SCENARIOS.clear) === 'down'
  const sameOk = compareWeatherLevel('orange', 'orange') === 'same'
  check(
    'compareWeatherLevel 正确判定升档 / 降档 / 同档',
    upOk && downOk && sameOk,
    `yellow→red=${compareWeatherLevel('yellow', 'red')}；`
    + `暴雨红警→晴好=${compareWeatherLevel(WEATHER_SCENARIOS.rainstorm_red, WEATHER_SCENARIOS.clear)}；`
    + `orange→orange=${compareWeatherLevel('orange', 'orange')}`,
  )

  // 9. 非法等级快速失败
  const badCompare = safe(() => compareWeatherLevel('purple', 'red'))
  check(
    'compareWeatherLevel 对未知等级抛错（不静默按同档处理）',
    !badCompare.ok && /未知预警等级/.test(badCompare.error),
    badCompare.ok ? '未抛错' : badCompare.error,
  )

  // 10. snapshot 工厂默认行为
  let tick = 0
  const clock = () => new Date(Date.parse('2026-09-28T14:00:00+08:00') + (tick += 1) * 60_000)
  const source = createWeatherSource({ initialScenarioId: 'clear', now: clock })
  const currentOk = source.getCurrent().id === 'clear' && source.mode === 'snapshot' && source.available === true
  const listOk = source.listScenarios().length === ids.length && Object.isFrozen(source.listScenarios())
  const clearAlertsOk = source.getAlerts().length === 0
  check(
    'snapshot 工厂：默认基线晴好、场景列表完整、晴好无预警条目',
    currentOk && listOk && clearAlertsOk,
    `getCurrent=${source.getCurrent().id}；listScenarios=${source.listScenarios().length} 个；`
    + `晴好预警条目=${source.getAlerts().length} 条`,
  )

  // 11. 预警条目结构与等级序值
  source.setScenario('rainstorm_red')
  const alert = source.getAlerts()[0]
  const alertOk = source.getAlerts().length === 1
    && alert.level === 'red'
    && alert.levelOrder === WEATHER_LEVEL_ORDER.red
    && alert.isDemo === true
    && alert.kind === 'rainstorm'
  check(
    '预警条目结构正确（1 条 red / levelOrder=3 / kind=rainstorm / 标注演示数据）',
    alertOk,
    `getAlerts()=${JSON.stringify(source.getAlerts().map((item) => `${item.label}#${item.levelOrder}`))}`,
  )

  // 12. 订阅：立即回调 + 切换通知 + 取消订阅生效
  const seen = []
  const unsubscribe = source.subscribe((scenario) => seen.push(scenario.id))
  const immediateOk = seen.length === 1 && seen[0] === 'rainstorm_red'
  source.setScenario('hail_orange')
  const notifyOk = seen.length === 2 && seen[1] === 'hail_orange'
  unsubscribe()
  source.setScenario('clear')
  const unsubscribedOk = seen.length === 2
  check(
    'subscribe 立即回调、切换时通知、取消订阅后不再收到通知',
    immediateOk && notifyOk && unsubscribedOk,
    `回调序列：${seen.join(' → ')}；取消后是否继续收到：${seen.length > 2}`,
  )

  // 13. history 升档/降档时间线
  // ★ 必须用一个全新的 source 实例：上面的用例已经切换过场景，
  //   复用同一实例会把那些切换记录一并算进来，断言就失去意义。
  let histTick = 0
  const histClock = () => new Date(Date.parse('2026-09-28T14:00:00+08:00') + (histTick += 1) * 60_000)
  const histSource = createWeatherSource({ initialScenarioId: 'clear', now: histClock })
  histSource.setScenario('rainstorm_red') // 蓝 → 红：升档
  histSource.setScenario('hail_orange') // 红 → 橙：降档
  histSource.setScenario('clear') // 橙 → 蓝：降档

  const timeline = histSource.history()
  const timelineOk = timeline.length === 3
    && timeline[0].direction === 'up' && timeline[0].fromLevel === 'blue' && timeline[0].toLevel === 'red'
    && timeline[1].direction === 'down' && timeline[1].fromLevel === 'red' && timeline[1].toLevel === 'orange'
    && timeline[2].direction === 'down' && timeline[2].fromLevel === 'orange' && timeline[2].toLevel === 'blue'
    && Object.isFrozen(timeline)
  check(
    'history 记录升档/降档时间线（含 at/fromLevel/toLevel/scenarioId/direction）',
    timelineOk,
    timeline.map((item) => `${item.fromLevel}→${item.toLevel}(${item.direction})`).join(' | '),
  )

  // 13b. 切到同一场景也留痕（direction: 'same'）
  const sameSource = createWeatherSource({ initialScenarioId: 'clear', now: histClock })
  sameSource.setScenario('clear')
  const sameTimeline = sameSource.history()
  check(
    'history 对"切到同一场景"也留痕（direction: same）',
    sameTimeline.length === 1 && sameTimeline[0].direction === 'same',
    `${sameTimeline[0]?.fromLevel}→${sameTimeline[0]?.toLevel}(${sameTimeline[0]?.direction})`,
  )

  // 14. 非法场景 id 抛错
  const badScenario = safe(() => source.setScenario('typhoon_purple'))
  check(
    'setScenario 对未知场景 id 抛错并列出可用场景',
    !badScenario.ok && /未知天气场景 id/.test(badScenario.error),
    badScenario.ok ? '未抛错' : badScenario.error,
  )

  // 15. live 模式：占位实现明确抛错，且文案指向服务端代理、无第三方 URL / Key
  const live = createWeatherSource({ mode: WEATHER_SOURCE_MODES.LIVE })
  const liveCurrent = safe(() => live.getCurrent())
  // ★ 本项同时是一条合规自检：文案与常量里不得出现第三方 URL、不得出现疑似密钥的长串。
  //   密钥前缀字面量本身也不写进代码 —— 交付前的密钥扫查要能做到 0 命中，不留误报噪音。
  const reasonOk = /服务端代理 \/api\/weather/.test(LIVE_SOURCE_UNAVAILABLE_REASON)
    && /API Key/.test(LIVE_SOURCE_UNAVAILABLE_REASON)
    && !/https?:\/\//.test(LIVE_SOURCE_UNAVAILABLE_REASON)
    && !/[A-Za-z0-9]{24,}/.test(LIVE_SOURCE_UNAVAILABLE_REASON)
  check(
    'live 模式 getCurrent() 明确抛错，文案要求服务端代理且不含第三方 URL / 密钥',
    !liveCurrent.ok && /L1 实时接口未接入/.test(liveCurrent.error) && reasonOk,
    liveCurrent.ok ? '未抛错（不合规）' : liveCurrent.error,
  )

  // 16. live 模式其余方法行为一致
  const liveAlerts = safe(() => live.getAlerts())
  const liveSet = safe(() => live.setScenario('clear'))
  const liveUnsubscribe = live.subscribe(() => {})
  check(
    'live 模式 getAlerts / setScenario 抛错，listScenarios / history 返回空，subscribe 返回空取消函数',
    !liveAlerts.ok && !liveSet.ok && live.listScenarios().length === 0
    && live.history().length === 0 && typeof liveUnsubscribe === 'function' && live.available === false,
    `getAlerts 抛错=${!liveAlerts.ok}；setScenario 抛错=${!liveSet.ok}；可用性标记 available=${live.available}`,
  )

  // 17. 非法 mode 抛错
  const badMode = safe(() => createWeatherSource({ mode: 'realtime' }))
  check(
    '未知数据源模式抛错（不静默回落到快照）',
    !badMode.ok && /未知天气数据源模式/.test(badMode.error),
    badMode.ok ? '未抛错' : badMode.error,
  )

  return {
    name: 'weatherDataSource',
    passed: checks.every((item) => item.passed),
    checks,
  }
}
