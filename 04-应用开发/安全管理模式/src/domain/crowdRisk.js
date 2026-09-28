/**
 * 人流阈值风控判定
 * ---------------------------------------------------------------------------
 * 路线 A / 决策项 A-12 双阈值迟滞 + A-13 驻留时间 + A-14 冷却期
 *              + A-15 趋势外推 + A-17 空间传播
 *
 * ★ 这是路线 A 里最容易被做废的地方。
 *   绝大多数方案止步于「超过阈值就报警」—— 那结果一定是
 *   第一天报警 200 次、第二天开始没人看。把防抖做对，才是"设计过的风控"。
 *
 * 四个机制的职责边界（方案书写法）：
 *   双阈值迟滞 —— 上升沿 / 下降沿分离，消除阈值附近的反复横跳
 *   驻留时间   —— 需连续 N 个采样片确认，抑制瞬时噪声
 *   冷却期     —— 告警去重 + 处置窗口，避免同一地点重复推送
 *   趋势外推   —— 斜率转正即提前预置提醒，从事后知道变成事前预警
 */

import { PLACE_CAPACITY, applyWeatherToThresholds, getPlaceSensitivity } from './crowd.js'

/** 风险档位（四档 —— 决策项 A-18） */
export const RISK_LEVEL = Object.freeze({
  NORMAL: 'normal', // 正常
  WARN: 'warn', // 关注
  HIGH: 'high', // 高
  CRITICAL: 'critical', // 严重
})

export const RISK_LEVEL_LABELS = Object.freeze({
  normal: '正常',
  warn: '关注',
  high: '高风险',
  critical: '严重',
})

/** 四色映射（供地图风险区图层 / 图例使用） */
export const RISK_LEVEL_COLORS = Object.freeze({
  normal: '#3fa96a',
  warn: '#e0a92b',
  high: '#e2703a',
  critical: '#d1414a',
})

export const RISK_LEVEL_ORDER = Object.freeze({ normal: 0, warn: 1, high: 2, critical: 3 })

/**
 * ★ 默认阈值配置（决策项 A-12 / A-13 / A-14 的参数取值）
 *
 * 每一档含四个参数：
 *  - `up`   上升沿阈值：占用率**升破**此值才可能触发
 *  - `down` 下降沿阈值：占用率**跌破**此值才解除（必须低于 up，形成迟滞带）
 *  - `dwell` 驻留片数：需连续 N 个采样片超限才成立
 *  - `cooldownMs` 冷却时长：处置后同一地点在此时长内不重复告警
 */
export const DEFAULT_THRESHOLDS = Object.freeze({
  warn: Object.freeze({ up: 0.75, down: 0.65, dwell: 2, cooldownMs: 10 * 60 * 1000 }),
  high: Object.freeze({ up: 0.9, down: 0.8, dwell: 3, cooldownMs: 15 * 60 * 1000 }),
  critical: Object.freeze({ up: 1.05, down: 0.95, dwell: 3, cooldownMs: 20 * 60 * 1000 }),
})

/** 触发原因码（可解释性 —— 每一条告警都要能说清"为什么"） */
export const TRIGGER_REASONS = Object.freeze({
  OCCUPANCY: 'occupancy', // 占用率超阈值
  DWELL: 'dwell', // 驻留确认后升级
  TREND: 'trend', // 趋势外推提前预警
  PROPAGATION: 'propagation', // 邻近地点拥挤传导
  BASELINE: 'baseline', // 显著高于同时段基线
})

export const TRIGGER_REASON_LABELS = Object.freeze({
  occupancy: '占用率超过安全容量比例',
  dwell: '连续多个采样片持续超限，已确认非瞬时尖峰',
  trend: '占用率快速上升，按趋势外推将超限',
  propagation: '邻近地点拥挤，人流溢出传导',
  baseline: '显著高于近 7 天同时段基线',
})

/**
 * 判定单条读数是否满足某一档的**上升/下降**条件
 *
 * @param {object} reading 人流读数（见 crowd.js createCrowdReading）
 * @param {object} thresholds 阈值配置
 * @returns {{ breach: string|null, triggerLevel: string|null, releaseLevels: string[], detail: string }}
 */
export function matchThreshold(reading, thresholds) {
  const ratio = reading?.ratio ?? 0
  let breach = null
  let triggerLevel = null
  const releaseLevels = []

  // 上升沿：从高到低检查，命中最高档即止
  for (const level of ['critical', 'high', 'warn']) {
    const config = thresholds[level]
    if (!config) continue
    if (ratio >= config.up) {
      breach = level
      triggerLevel = level
      break
    }
  }

  // 下降沿：占用率跌破哪一档的 down，就从那一档解除
  for (const level of ['critical', 'high', 'warn']) {
    const config = thresholds[level]
    if (!config) continue
    if (ratio < config.down) releaseLevels.push(level)
  }

  const detail = breach
    ? `占用率 ${(ratio * 100).toFixed(1)}% ≥ ${RISK_LEVEL_LABELS[breach]}档上升沿 ${(thresholds[breach].up * 100).toFixed(0)}%`
    : `占用率 ${(ratio * 100).toFixed(1)}% 未触及任何上升沿（关注档 ${(thresholds.warn.up * 100).toFixed(0)}%）`

  return { breach, triggerLevel, releaseLevels, detail }
}

/**
 * 无状态判定：只看一个时间窗口内的读数，判定当前风险档位
 *
 * 用于「一次性快照」（例如地图刷新时重算当前态）。
 * 需要跨时间的冷却期语义时请用 `createCrowdRiskEvaluator`。
 *
 * @param {object[]} series 同一地点的读数序列（时间升序）
 * @param {{ thresholds?: object, weather?: object|null, baselineRatio?: number|null }} [options]
 * @returns {object} 判定结果
 */
export function evaluateCrowdRisk(series = [], options = {}) {
  const { weather = null, baselineRatio = null } = options
  const thresholds = options.thresholds?.warn
    ? (weather ? applyWeatherToThresholds(options.thresholds, weather) : options.thresholds)
    : applyWeatherToThresholds(DEFAULT_THRESHOLDS, weather)

  const base = {
    locationId: series.at(-1)?.locationId ?? null,
    name: series.at(-1)?.name ?? null,
    level: RISK_LEVEL.NORMAL,
    previousLevel: RISK_LEVEL.NORMAL,
    reason: null,
    evidence: [],
    dwellCount: 0,
    dwellRequired: 0,
    thresholds,
    weatherAdjusted: Boolean(thresholds.weatherAdjusted),
    trend: series.at(-1)?.trend ?? null,
  }

  if (!series.length) {
    return { ...base, evidence: [{ label: '无数据', detail: '该地点暂无采样数据，不参与风控判定' }] }
  }

  const latest = series.at(-1)
  const match = matchThreshold(latest, thresholds)

  // ① 趋势外推（A-15）：还没超限，但斜率指向超限
  const trendTrigger = detectTrendTrigger(series, thresholds)

  // ② 未触及上升沿 —— 再看趋势
  if (!match.breach) {
    if (trendTrigger.triggered) {
      return {
        ...base,
        level: RISK_LEVEL.WARN,
        reason: TRIGGER_REASONS.TREND,
        trend: latest.trend,
        evidence: [
          { label: '趋势外推', detail: trendTrigger.detail },
          { label: '当前占用率', detail: `${(latest.ratio * 100).toFixed(1)}% / 容量 ${latest.effectiveCapacity} 人` },
        ],
      }
    }
    return {
      ...base,
      evidence: [
        { label: '判定依据', detail: match.detail },
        { label: '占用率', detail: `${latest.count} / ${latest.effectiveCapacity} 人 = ${(latest.ratio * 100).toFixed(1)}%` },
        ...(weather ? [{ label: '天气修正', detail: `容量已按${latest.placeKind === 'road' || latest.placeKind === 'sports' || latest.placeKind === 'plaza' || latest.placeKind === 'gate' ? '室外' : '室内'}系数 ×${latest.weatherFactor} 折减` }] : []),
      ],
    }
  }

  // ③ 驻留确认（A-13）：连续 N 片均超限
  const dwellResult = countDwell(series, thresholds[match.breach].up)
  if (dwellResult.count < thresholds[match.breach].dwell) {
    return {
      ...base,
      level: RISK_LEVEL.WARN,
      reason: TRIGGER_REASONS.OCCUPANCY,
      dwellCount: dwellResult.count,
      dwellRequired: thresholds[match.breach].dwell,
      evidence: [
        { label: '触发档位', detail: match.detail },
        { label: '驻留确认中', detail: `已连续 ${dwellResult.count} 片超限，需 ${thresholds[match.breach].dwell} 片才确认（抑制瞬时尖峰）` },
      ],
    }
  }

  // ④ 基线对照（可选）：显著高于同时段基线时才升级
  const evidence = [
    { label: '触发档位', detail: match.detail },
    { label: '驻留确认', detail: `已连续 ${dwellResult.count} 片超限（阈值 ${thresholds[match.breach].dwell} 片）` },
    { label: '占用率', detail: `${latest.count} / ${latest.effectiveCapacity} 人 = ${(latest.ratio * 100).toFixed(1)}%` },
  ]

  let level = match.breach
  if (baselineRatio != null && latest.baseline != null) {
    const ratioToBaseline = latest.baseline > 0 ? latest.ratio / latest.baseline : 1
    evidence.push({
      label: '同时段基线',
      detail: `基线 ${(latest.baseline * 100).toFixed(1)}%，当前为其 ${ratioToBaseline.toFixed(2)} 倍`,
    })
  }
  if (weather) {
    evidence.push({ label: '天气修正', detail: `${thresholds.weatherLabel ?? '天气'}已下调阈值（×${thresholds.shrink?.toFixed(2) ?? '1.00'}）` })
  }
  if (trendTrigger.triggered) {
    evidence.push({ label: '趋势', detail: trendTrigger.detail })
  }

  return {
    ...base,
    level,
    reason: TRIGGER_REASONS.OCCUPANCY,
    dwellCount: dwellResult.count,
    dwellRequired: thresholds[match.breach].dwell,
    evidence,
  }
}

/**
 * 趋势外推判定（A-15）
 * 判据：近 `window` 片的斜率持续为正，且按当前斜率外推 `horizon` 片后将触及关注档
 *
 * @param {object[]} series 读数序列
 * @param {object} thresholds
 * @param {{ window?: number, horizon?: number }} [options]
 */
export function detectTrendTrigger(series, thresholds, options = {}) {
  const { window = 3, horizon = 2 } = options
  if (series.length < window) {
    return { triggered: false, slope: 0, detail: `样本不足 ${window} 片，不做趋势外推` }
  }

  const recent = series.slice(-window)
  const first = recent[0]
  const last = recent.at(-1)
  const span = Math.max(1, recent.length - 1)
  const slope = (last.ratio - first.ratio) / span

  const projected = last.ratio + slope * horizon
  const target = thresholds.warn.up

  if (slope > 0 && projected >= target) {
    return {
      triggered: true,
      slope,
      projected,
      detail: `近 ${window} 片占用率由 ${(first.ratio * 100).toFixed(1)}% 升至 ${(last.ratio * 100).toFixed(1)}%，` +
        `斜率 +${(slope * 100).toFixed(1)}%/片，外推 ${horizon} 片将达 ${(projected * 100).toFixed(1)}%（关注档 ${(target * 100).toFixed(0)}%）`,
    }
  }

  return {
    triggered: false,
    slope,
    projected,
    detail: `近 ${window} 片斜率 ${slope >= 0 ? '+' : ''}${(slope * 100).toFixed(1)}%/片，外推 ${(projected * 100).toFixed(1)}%，未触及关注档`,
  }
}

/**
 * 统计序列末端的连续超限片数（驻留确认）
 *
 * @param {object[]} series 读数序列
 * @param {number} upThreshold 上升沿阈值
 * @returns {{ count: number, startTs: number|null, startRatio: number|null }}
 */
export function countDwell(series, upThreshold) {
  let count = 0
  let startTs = null
  let startRatio = null

  for (let i = series.length - 1; i >= 0; i -= 1) {
    if ((series[i].ratio ?? 0) >= upThreshold) {
      count += 1
      startTs = series[i].ts ?? null
      startRatio = series[i].ratio ?? null
    } else {
      break
    }
  }

  return { count, startTs, startRatio }
}

/**
 * ★ 有状态评估器 —— 跨时间维护「当前档位 + 冷却期」（A-12 / A-14）
 *
 * 这是真正的风控入口：迟滞依赖"上一次的档位"，冷却依赖"上次告警的时间"，
 * 两者都是状态，不能靠单次纯函数算出来。
 *
 * @param {{ thresholds?: object, weather?: object|null, now?: number }} [config]
 * @returns {object} 评估器实例
 */
export function createCrowdRiskEvaluator(config = {}) {
  const state = new Map() // locationId → { level, lastAlertAt, lastAlertLevel, dwellCount, history }

  const getState = (locationId) => {
    if (!state.has(locationId)) {
      state.set(locationId, {
        level: RISK_LEVEL.NORMAL,
        lastAlertAt: null,
        lastAlertLevel: null,
        dwellCount: 0,
        history: [],
      })
    }
    return state.get(locationId)
  }

  return {
    /**
     * 评估一条新读数，推进该地点的风险状态机
     *
     * @param {object} reading 人流读数
     * @param {{ weather?: object|null, now?: number }} [context]
     * @returns {object} { level, previousLevel, changed, direction, alert, suppressed, release, evidence }
     */
    evaluate(reading, context = {}) {
      const weather = context.weather ?? config.weather ?? null
      const now = context.now ?? reading.ts ?? config.now ?? 0
      const thresholds = config.thresholds?.warn
        ? (weather ? applyWeatherToThresholds(config.thresholds, weather) : config.thresholds)
        : applyWeatherToThresholds(DEFAULT_THRESHOLDS, weather)

      const current = getState(reading.locationId)
      current.history.push(reading)
      if (current.history.length > 96) current.history.shift() // 保留一天（96 个 15 分钟桶）

      const previousLevel = current.level
      const match = matchThreshold(reading, thresholds)
      const trendTrigger = detectTrendTrigger(current.history, thresholds)

      // ---- ① 计算目标档位（含迟滞：未跌破 down 就不降档）----
      let targetLevel = RISK_LEVEL.NORMAL

      if (match.breach) {
        const upLevel = match.breach
        const dwell = countDwell(current.history, thresholds[upLevel].up)
        current.dwellCount = dwell.count

        if (dwell.count >= thresholds[upLevel].dwell) {
          targetLevel = upLevel
        } else {
          // 驻留未满：不足以升到该档，但至少是关注
          targetLevel = RISK_LEVEL.WARN
        }
      } else if (trendTrigger.triggered) {
        targetLevel = RISK_LEVEL.WARN
      }

      // 迟滞：当前档位若高于目标，需跌破该档的 down 才降档
      if (RISK_LEVEL_ORDER[previousLevel] > RISK_LEVEL_ORDER[targetLevel]) {
        const currentConfig = thresholds[previousLevel]
        if (currentConfig && reading.ratio >= currentConfig.down) {
          targetLevel = previousLevel // 落在迟滞带内 → 维持原档，不降
        }
      }

      const changed = targetLevel !== previousLevel
      const direction = RISK_LEVEL_ORDER[targetLevel] > RISK_LEVEL_ORDER[previousLevel]
        ? 'up'
        : RISK_LEVEL_ORDER[targetLevel] < RISK_LEVEL_ORDER[previousLevel] ? 'down' : 'same'

      // ---- ② 冷却期（A-14）：同地点同档位在冷却窗口内不重复告警 ----
      let alert = null
      let suppressed = null

      if (RISK_LEVEL_ORDER[targetLevel] >= RISK_LEVEL_ORDER[RISK_LEVEL.WARN]) {
        const cooldown = thresholds[targetLevel]?.cooldownMs ?? 0
        const withinCooldown = current.lastAlertAt != null
          && current.lastAlertLevel === targetLevel
          && (now - current.lastAlertAt) < cooldown

        if (withinCooldown) {
          const remainMs = cooldown - (now - current.lastAlertAt)
          suppressed = {
            level: targetLevel,
            remainMs,
            detail: `同档位告警处于冷却期，剩余 ${Math.ceil(remainMs / 60000)} 分钟不重复推送（告警去重）`,
          }
        } else {
          const reason = match.breach
            ? (current.dwellCount >= (thresholds[match.breach]?.dwell ?? 1) ? TRIGGER_REASONS.OCCUPANCY : TRIGGER_REASONS.DWELL)
            : TRIGGER_REASONS.TREND

          alert = {
            locationId: reading.locationId,
            name: reading.name,
            placeKind: reading.placeKind,
            level: targetLevel,
            previousLevel,
            direction,
            reason,
            reasonLabel: TRIGGER_REASON_LABELS[reason],
            ratio: reading.ratio,
            count: reading.count,
            effectiveCapacity: reading.effectiveCapacity,
            trend: reading.trend,
            sensitivity: getPlaceSensitivity(reading.placeKind),
            raisedAt: now,
            weatherAdjusted: Boolean(thresholds.weatherAdjusted),
            evidence: buildEvidence({ reading, match, thresholds, current, trendTrigger, dwellCount: current.dwellCount }),
          }
          current.lastAlertAt = now
          current.lastAlertLevel = targetLevel
        }
      }

      // ---- ③ 解除（下降沿）----
      let release = null
      if (previousLevel !== RISK_LEVEL.NORMAL && targetLevel === RISK_LEVEL.NORMAL) {
        release = {
          locationId: reading.locationId,
          name: reading.name,
          fromLevel: previousLevel,
          ratio: reading.ratio,
          detail: `占用率回落至 ${(reading.ratio * 100).toFixed(1)}%，` +
            `已跌破${RISK_LEVEL_LABELS[previousLevel]}档下降沿 ${((thresholds[previousLevel]?.down ?? 0) * 100).toFixed(0)}%，风险解除`,
        }
      }

      current.level = targetLevel
      if (targetLevel === RISK_LEVEL.NORMAL) current.dwellCount = 0

      return {
        locationId: reading.locationId,
        level: targetLevel,
        previousLevel,
        changed,
        direction,
        thresholds,
        dwellCount: current.dwellCount,
        alert,
        suppressed,
        release,
        evidence: alert?.evidence ?? buildEvidence({ reading, match, thresholds, current, trendTrigger, dwellCount: current.dwellCount }),
      }
    },

    /** 主动确认处置：写入冷却期（处置后 T 分钟内不重复告警） */
    acknowledge(locationId, at = 0) {
      const current = getState(locationId)
      current.lastAlertAt = at
      current.lastAlertLevel = current.level
      return { locationId, level: current.level, acknowledgedAt: at }
    },

    /** 读取某地点当前状态（只读快照） */
    peek(locationId) {
      const current = state.get(locationId)
      if (!current) return { locationId, level: RISK_LEVEL.NORMAL, history: [] }
      return { ...current, history: [...current.history] }
    },

    /** 列出所有处于告警档位的地点 */
    listActive() {
      return [...state.entries()]
        .filter(([, value]) => RISK_LEVEL_ORDER[value.level] >= RISK_LEVEL_ORDER[RISK_LEVEL.WARN])
        .map(([locationId, value]) => ({ locationId, level: value.level, latest: value.history.at(-1) ?? null }))
    },

    reset() {
      state.clear()
    },
  }
}

function buildEvidence({ reading, match, thresholds, current, trendTrigger, dwellCount }) {
  const evidence = [
    { label: '占用率', detail: `${reading.count} / ${reading.effectiveCapacity} 人 = ${(reading.ratio * 100).toFixed(1)}%` },
    { label: '阈值判定', detail: match.detail },
  ]

  if (match.breach) {
    evidence.push({
      label: '驻留确认',
      detail: `${dwellCount} / ${thresholds[match.breach].dwell} 片` +
        (dwellCount >= thresholds[match.breach].dwell ? '（已确认）' : '（确认中，抑制瞬时尖峰）'),
    })
  }

  if (reading.trend != null) {
    evidence.push({
      label: '变化趋势',
      detail: `${reading.trend >= 0 ? '+' : ''}${(reading.trend * 100).toFixed(1)}%/片` +
        (trendTrigger.triggered ? `，${trendTrigger.detail}` : ''),
    })
  }

  if (thresholds.weatherAdjusted) {
    evidence.push({ label: '天气修正', detail: `安全容量与阈值已按${thresholds.weatherLabel ?? '恶劣天气'}折减 ×${thresholds.shrink?.toFixed(2) ?? '—'}` })
  }

  evidence.push({
    label: '场所敏感度',
    detail: `${reading.name}（${reading.placeKind}）敏感度 ×${getPlaceSensitivity(reading.placeKind).weight} —— ${getPlaceSensitivity(reading.placeKind).reason}`,
  })

  if (current.lastAlertAt != null) {
    evidence.push({ label: '上次同档告警', detail: `时间戳 ${current.lastAlertAt}（用于冷却期去重）` })
  }

  return evidence
}

/**
 * ★ 空间传播（A-17）—— 从「计数器」升级为「风控系统」的分界
 *
 * 人流溢出是**空间相关**的：食堂拥挤必然带动相邻商业街与路口。
 * 本函数沿邻接关系扩散预警，为上游路口产出「提前分流」建议。
 *
 * @param {object} input
 * @param {Array<{ locationId: string, level: string, ratio?: number }>} input.readings 各地点的当前风险
 * @param {Record<string, string[]>} input.adjacency 邻接表 locationId → 相邻 locationId[]
 * @param {{ decay?: number, maxHops?: number }} [options]
 * @returns {{ propagated: Array, adjacencyUsed: number, detail: string }}
 */
export function propagateCrowdRisk({ readings = [], adjacency = {} }, options = {}) {
  const { decay = 0.5, maxHops = 1 } = options
  const levelByPlace = new Map(readings.map((item) => [item.locationId, item]))
  const propagated = []

  for (const source of readings) {
    if (RISK_LEVEL_ORDER[source.level] < RISK_LEVEL_ORDER[RISK_LEVEL.WARN]) continue

    let frontier = [source.locationId]
    const visited = new Set([source.locationId])

    for (let hop = 1; hop <= maxHops; hop += 1) {
      const next = []
      for (const nodeId of frontier) {
        for (const neighborId of adjacency[nodeId] ?? []) {
          if (visited.has(neighborId)) continue
          visited.add(neighborId)
          next.push(neighborId)

          // 每跳衰减：邻居获得「关注」级提示，不会直接跳到高风险
          const sourceOrder = RISK_LEVEL_ORDER[source.level]
          const propagatedOrder = Math.max(1, Math.min(sourceOrder - hop, RISK_LEVEL_ORDER.high))
          const level = Object.keys(RISK_LEVEL_ORDER).find((key) => RISK_LEVEL_ORDER[key] === propagatedOrder)
          const neighbor = levelByPlace.get(neighborId)

          propagated.push({
            locationId: neighborId,
            name: neighbor?.name ?? neighborId,
            level,
            sourceLocationId: source.locationId,
            sourceName: source.name,
            hop,
            strength: Math.round(decay ** hop * 100) / 100,
            reason: TRIGGER_REASONS.PROPAGATION,
            reasonLabel: TRIGGER_REASON_LABELS.propagation,
            detail: `邻近的${source.name}（${RISK_LEVEL_LABELS[source.level]}）人流溢出传导，` +
              `衰减至 ${(decay ** hop * 100).toFixed(0)}%，建议上游提前分流`,
            evidence: [
              { label: '传导来源', detail: `${source.name} 当前 ${RISK_LEVEL_LABELS[source.level]}` },
              { label: '传导距离', detail: `${hop} 跳，强度衰减至 ${(decay ** hop * 100).toFixed(0)}%` },
              { label: '建议处置', detail: '上游路口提前分流，避免人流向拥挤点继续汇聚' },
            ],
          })
        }
      }
      frontier = next
    }
  }

  // 同一地点被多处传导时只保留最强的一条
  const strongest = new Map()
  for (const item of propagated) {
    const existing = strongest.get(item.locationId)
    if (!existing || RISK_LEVEL_ORDER[item.level] > RISK_LEVEL_ORDER[existing.level]) {
      strongest.set(item.locationId, item)
    }
  }

  return {
    propagated: [...strongest.values()],
    adjacencyUsed: Object.keys(adjacency).length,
    detail: `邻接表覆盖 ${Object.keys(adjacency).length} 个地点，产出 ${strongest.size} 条传导预警`,
  }
}

/**
 * 汇总风险总览（供安全态势大屏 E-1 使用）
 *
 * @param {Array<{ level: string }>} items 风险项列表
 * @returns {{ counts: object, total: number, highest: string, summary: string }}
 */
export function summarizeRiskLevels(items = []) {
  const counts = { normal: 0, warn: 0, high: 0, critical: 0 }
  for (const item of items) {
    if (counts[item.level] != null) counts[item.level] += 1
  }
  const highest = ['critical', 'high', 'warn', 'normal'].find((level) => counts[level] > 0) ?? 'normal'

  return {
    counts,
    total: items.length,
    highest,
    summary: `严重 ${counts.critical} · 高风险 ${counts.high} · 关注 ${counts.warn} · 正常 ${counts.normal}`,
  }
}

/**
 * 模块自检（零依赖，可直接用 node 运行）
 * @returns {{ name: string, passed: boolean, checks: Array<{label: string, passed: boolean, detail: string}> }}
 */
export function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  const place = PLACE_CAPACITY.Canteen // 容量 396
  const makeSeries = (ratios) => ratios.map((ratio, index) => ({
    locationId: 'Canteen',
    name: '第三食堂',
    placeKind: 'dining',
    count: Math.round(ratio * 396),
    capacity: 396,
    effectiveCapacity: 396,
    ratio,
    trend: null,
    ts: index * 60000,
  }))

  // ① 双阈值迟滞：迟滞带内不降档
  const evaluator = createCrowdRiskEvaluator()
  const rising = [0.60, 0.80, 0.92, 0.92, 0.92]
  let last = null
  rising.forEach((ratio, index) => {
    last = evaluator.evaluate(makeSeries([ratio])[0], { now: index * 60000 })
  })
  add('① 双阈值迟滞：连续超限可升档',
    RISK_LEVEL_ORDER[last.level] >= RISK_LEVEL_ORDER[RISK_LEVEL.HIGH],
    `占用率 0.92 连续 5 片 → 档位「${RISK_LEVEL_LABELS[last.level]}」`)

  // ② 落在迟滞带内维持原档（不降）
  const inBand = evaluator.evaluate(makeSeries([0.85])[0], { now: 6 * 60000 })
  add('② 双阈值迟滞：落入迟滞带内维持原档不降',
    inBand.level === last.level,
    `0.92 → 0.85（高于高档下降沿 0.80）→ 仍为「${RISK_LEVEL_LABELS[inBand.level]}」，未降档`)

  // ③ 跌破下降沿才降档
  const belowBand = evaluator.evaluate(makeSeries([0.70])[0], { now: 7 * 60000 })
  add('③ 跌破下降沿才解除风险',
    RISK_LEVEL_ORDER[belowBand.level] < RISK_LEVEL_ORDER[last.level],
    `0.85 → 0.70（低于高档下降沿 0.80）→ 降为「${RISK_LEVEL_LABELS[belowBand.level]}」`)

  // ④ 驻留时间：单次尖峰不成立
  const freshEvaluator = createCrowdRiskEvaluator()
  const spike = freshEvaluator.evaluate(makeSeries([0.95])[0], { now: 0 })
  add('④ 驻留时间：单次瞬时尖峰不足以升到高风险档',
    RISK_LEVEL_ORDER[spike.level] < RISK_LEVEL_ORDER[RISK_LEVEL.HIGH] && spike.dwellCount === 1,
    `仅 1 片 0.95（需 3 片）→ 档位「${RISK_LEVEL_LABELS[spike.level]}」，驻留 ${spike.dwellCount}/3`)

  // ⑤ 驻留满则升级
  let dwelled = null
  ;[1, 2].forEach((index) => {
    dwelled = freshEvaluator.evaluate(makeSeries([0.95])[0], { now: index * 60000 })
  })
  add('⑤ 驻留时间：连续 3 片超限即确认升级',
    dwelled.level === RISK_LEVEL.HIGH && dwelled.dwellCount >= 3,
    `连续 ${dwelled.dwellCount} 片 0.95 → 档位「${RISK_LEVEL_LABELS[dwelled.level]}」`)

  // ⑥ 冷却期：同档位不重复告警
  const cooldownEvaluator = createCrowdRiskEvaluator()
  const firstAlert = []
  ;[0, 1, 2, 3, 4].forEach((index) => {
    firstAlert.push(cooldownEvaluator.evaluate(makeSeries([0.95])[0], { now: index * 60000 }))
  })
  const alertCount = firstAlert.filter((item) => item.alert).length
  const suppressed = firstAlert.find((item) => item.suppressed)
  add('⑥ 冷却期：同一地点同档位不重复推送',
    alertCount < firstAlert.length && Boolean(suppressed),
    `5 次评估仅产生 ${alertCount} 次告警，${firstAlert.length - alertCount} 次被冷却期抑制（剩余 ${Math.ceil((suppressed?.suppressed?.remainMs ?? 0) / 60000)} 分钟）`)

  // ⑦ 冷却结束后可再次告警
  const afterCooldown = cooldownEvaluator.evaluate(makeSeries([0.95])[0], { now: 20 * 60000 })
  add('⑦ 冷却期结束后可再次告警',
    Boolean(afterCooldown.alert),
    `冷却期（15 分钟）过后再次产生告警：${afterCooldown.alert ? '是' : '否'}`)

  // ⑧ 趋势外推：未超限但斜率指向超限 → 提前预警
  const trendEvaluator = createCrowdRiskEvaluator()
  let trendResult = null
  ;[0.40, 0.55, 0.70].forEach((ratio, index) => {
    trendResult = trendEvaluator.evaluate(makeSeries([ratio])[0], { now: index * 60000 })
  })
  add('⑧ 趋势外推：未超限但斜率指向超限即提前预警',
    trendResult.level === RISK_LEVEL.WARN && trendResult.alert?.reason === TRIGGER_REASONS.TREND,
    `0.40 → 0.55 → 0.70（关注档 0.75）斜率 +15%/片 → 触发「${TRIGGER_REASON_LABELS[trendResult.alert?.reason ?? 'occupancy']}」`)

  // ⑨ 天气修正：同一占用率在暴雨下降档
  const weatherEval = createCrowdRiskEvaluator()
  const clearRun = createCrowdRiskEvaluator()
  let clearLevel = null
  let stormLevel = null
  ;[0, 1, 2].forEach((index) => {
    clearLevel = clearRun.evaluate(makeSeries([0.78])[0], { now: index * 60000, weather: { kind: 'clear' } })
    stormLevel = weatherEval.evaluate(makeSeries([0.78])[0], { now: index * 60000, weather: { kind: 'rainstorm' } })
  })
  add('⑨ ★ 天气修正：同一占用率晴天正常、暴雨告警',
    RISK_LEVEL_ORDER[stormLevel.level] > RISK_LEVEL_ORDER[clearLevel.level],
    `占用率 0.78：晴天「${RISK_LEVEL_LABELS[clearLevel.level]}」→ 暴雨「${RISK_LEVEL_LABELS[stormLevel.level]}」（阈值折减 ×${stormLevel.thresholds.shrink?.toFixed(2)}）`)

  // ⑩ 空间传播：邻接地点收到衰减预警
  const propagation = propagateCrowdRisk({
    readings: [
      { locationId: 'Canteen', name: '第三食堂', level: RISK_LEVEL.HIGH },
      { locationId: 'Road-Axis', name: '中轴大道', level: RISK_LEVEL.NORMAL },
    ],
    adjacency: { Canteen: ['Road-Axis', 'Plaza-Center'], 'Road-Axis': ['Canteen'] },
  })
  add('⑩ ★ 空间传播：邻近地点收到衰减预警',
    propagation.propagated.length >= 2 &&
    propagation.propagated.every((item) => RISK_LEVEL_ORDER[item.level] < RISK_LEVEL_ORDER[RISK_LEVEL.HIGH]),
    propagation.detail + `；例：${propagation.propagated[0]?.name} → ${RISK_LEVEL_LABELS[propagation.propagated[0]?.level ?? 'normal']}（强度 ${propagation.propagated[0]?.strength}）`)

  // ⑪ 可解释性：每条告警都带证据链
  add('⑪ 可解释性：告警携带可打印的证据链',
    Array.isArray(dwelled.alert?.evidence) && dwelled.alert.evidence.length >= 4,
    `${dwelled.alert?.evidence?.length ?? 0} 项证据：` + (dwelled.alert?.evidence ?? []).map((item) => item.label).join(' / '))

  // ⑫ 处置确认写入冷却期
  const ackEvaluator = createCrowdRiskEvaluator()
  ;[0, 1, 2].forEach((index) => ackEvaluator.evaluate(makeSeries([0.95])[0], { now: index * 60000 }))
  ackEvaluator.acknowledge('Canteen', 3 * 60000)
  const afterAck = ackEvaluator.evaluate(makeSeries([0.95])[0], { now: 4 * 60000 })
  add('⑫ 处置确认后进入冷却期，不重复打扰',
    Boolean(afterAck.suppressed),
    `确认处置后下一次评估被抑制：${afterAck.suppressed?.detail ?? '未抑制'}`)

  // ⑬ 风险总览汇总
  const overview = summarizeRiskLevels([
    { level: 'critical' }, { level: 'high' }, { level: 'high' }, { level: 'normal' },
  ])
  add('⑬ 风险总览汇总正确',
    overview.counts.critical === 1 && overview.counts.high === 2 && overview.highest === 'critical',
    overview.summary)

  return {
    name: 'domain/crowdRisk.js',
    passed: checks.every((check) => check.passed),
    checks,
  }
}
