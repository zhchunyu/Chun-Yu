/**
 * 安全模式 · 风控判定与预警分级（对齐 CampusTwin 真实数据）
 * ---------------------------------------------------------------------------
 * 合并自 `安全管理模式/src/domain/` 的 `crowdRisk.js` + `alert.js` + `playbook.js`，
 * 对齐真实建筑 id、真实 `type`、以及 `events.js` 的事件结构
 * （`type: activity | crowd | construction`，`affectedEdgeIds` 触发封路）。
 *
 * 四个防抖机制的职责边界（方案书写法）：
 *   双阈值迟滞 —— 上升沿 / 下降沿分离，消除阈值附近反复横跳
 *   驻留时间   —— 需连续 N 片确认，抑制瞬时噪声
 *   冷却期     —— 告警去重 + 处置窗口，避免同地点重复推送
 *   趋势外推   —— 斜率转正即提前预置提醒，从事后知道变成事前预警
 */

import {
  PLACE_CAPACITY, applyWeatherToThresholds, getPlaceSensitivity,
  COVERED_ROUTE_EDGES, LOW_LYING_EDGES, resolveLocationEdge,
} from './capacity.js'

// ===========================================================================
// 一、风险档位与阈值
// ===========================================================================

export const RISK_LEVEL = Object.freeze({
  NORMAL: 'normal',
  WARN: 'warn',
  HIGH: 'high',
  CRITICAL: 'critical',
})

export const RISK_LEVEL_LABELS = Object.freeze({
  normal: '正常', warn: '关注', high: '高风险', critical: '严重',
})

export const RISK_LEVEL_ORDER = Object.freeze({ normal: 0, warn: 1, high: 2, critical: 3 })

/** 四色映射 —— 使用 CampusTwin 纸墨色系里的强调色，避免与既有配色冲突 */
export const RISK_LEVEL_COLORS = Object.freeze({
  normal: '#6f9f68',
  warn: '#dca05a',
  high: '#ca704a',
  critical: '#c9685e',
})

export const DEFAULT_THRESHOLDS = Object.freeze({
  warn: Object.freeze({ up: 0.75, down: 0.65, dwell: 2, cooldownMs: 10 * 60 * 1000 }),
  high: Object.freeze({ up: 0.9, down: 0.8, dwell: 3, cooldownMs: 15 * 60 * 1000 }),
  critical: Object.freeze({ up: 1.05, down: 0.95, dwell: 3, cooldownMs: 20 * 60 * 1000 }),
})

export const TRIGGER_REASONS = Object.freeze({
  OCCUPANCY: 'occupancy',
  DWELL: 'dwell',
  TREND: 'trend',
  PROPAGATION: 'propagation',
})

export const TRIGGER_REASON_LABELS = Object.freeze({
  occupancy: '占用率超过安全容量比例',
  dwell: '连续多个采样片持续超限，已确认非瞬时尖峰',
  trend: '占用率快速上升，按趋势外推将超限',
  propagation: '邻近地点拥挤，人流溢出传导',
})

/** 判定单条读数的上升沿 / 下降沿 */
export function matchThreshold(reading, thresholds) {
  const ratio = reading?.ratio ?? 0
  let breach = null
  const releaseLevels = []

  for (const level of ['critical', 'high', 'warn']) {
    const config = thresholds[level]
    if (!config) continue
    if (ratio >= config.up) { breach = level; break }
  }
  for (const level of ['critical', 'high', 'warn']) {
    const config = thresholds[level]
    if (config && ratio < config.down) releaseLevels.push(level)
  }

  const detail = breach
    ? `占用率 ${(ratio * 100).toFixed(1)}% ≥ ${RISK_LEVEL_LABELS[breach]}档上升沿 ${(thresholds[breach].up * 100).toFixed(0)}%`
    : `占用率 ${(ratio * 100).toFixed(1)}% 未触及任何上升沿（关注档 ${(thresholds.warn.up * 100).toFixed(0)}%）`

  return { breach, releaseLevels, detail }
}

/** 统计序列末端的连续超限片数（驻留确认） */
export function countDwell(series, upThreshold) {
  let count = 0
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if ((series[i].ratio ?? 0) >= upThreshold) count += 1
    else break
  }
  return count
}

/** 趋势外推：未超限但斜率指向超限 */
export function detectTrendTrigger(series, thresholds, options = {}) {
  const { window = 3, horizon = 2 } = options
  if (series.length < window) {
    return { triggered: false, slope: 0, detail: `样本不足 ${window} 片，不做趋势外推` }
  }
  const recent = series.slice(-window)
  const first = recent[0]
  const last = recent.at(-1)
  const slope = (last.ratio - first.ratio) / Math.max(1, recent.length - 1)
  const projected = last.ratio + slope * horizon
  const target = thresholds.warn.up

  if (slope > 0 && projected >= target) {
    return {
      triggered: true, slope, projected,
      detail: `近 ${window} 片由 ${(first.ratio * 100).toFixed(1)}% 升至 ${(last.ratio * 100).toFixed(1)}%，` +
        `斜率 +${(slope * 100).toFixed(1)}%/片，外推 ${horizon} 片将达 ${(projected * 100).toFixed(1)}%（关注档 ${(target * 100).toFixed(0)}%）`,
    }
  }
  return {
    triggered: false, slope, projected,
    detail: `近 ${window} 片斜率 ${slope >= 0 ? '+' : ''}${(slope * 100).toFixed(1)}%/片，外推 ${(projected * 100).toFixed(1)}%，未触及关注档`,
  }
}

/**
 * ★ 有状态风控评估器 —— 跨时间维护「当前档位 + 冷却期」
 * 迟滞依赖"上一次的档位"、冷却依赖"上次告警时间"，两者都是状态，纯函数算不出来。
 */
export function createCrowdRiskEvaluator(config = {}) {
  const state = new Map()
  const getState = (locationId) => {
    if (!state.has(locationId)) {
      state.set(locationId, { level: RISK_LEVEL.NORMAL, lastAlertAt: null, lastAlertLevel: null, dwellCount: 0, history: [] })
    }
    return state.get(locationId)
  }

  return {
    evaluate(reading, context = {}) {
      const weather = context.weather ?? config.weather ?? null
      const now = context.now ?? reading.ts ?? 0
      const thresholds = config.thresholds?.warn
        ? (weather ? applyWeatherToThresholds(config.thresholds, weather) : config.thresholds)
        : applyWeatherToThresholds(DEFAULT_THRESHOLDS, weather)

      const current = getState(reading.locationId)
      current.history.push(reading)
      if (current.history.length > 96) current.history.shift()

      const previousLevel = current.level
      const match = matchThreshold(reading, thresholds)
      const trendTrigger = detectTrendTrigger(current.history, thresholds)

      let targetLevel = RISK_LEVEL.NORMAL
      if (match.breach) {
        current.dwellCount = countDwell(current.history, thresholds[match.breach].up)
        targetLevel = current.dwellCount >= thresholds[match.breach].dwell ? match.breach : RISK_LEVEL.WARN
      } else if (trendTrigger.triggered) {
        targetLevel = RISK_LEVEL.WARN
      }

      // 迟滞：落在迟滞带内维持原档，不降
      if (RISK_LEVEL_ORDER[previousLevel] > RISK_LEVEL_ORDER[targetLevel]) {
        const currentConfig = thresholds[previousLevel]
        if (currentConfig && reading.ratio >= currentConfig.down) targetLevel = previousLevel
      }

      const direction = RISK_LEVEL_ORDER[targetLevel] > RISK_LEVEL_ORDER[previousLevel] ? 'up'
        : RISK_LEVEL_ORDER[targetLevel] < RISK_LEVEL_ORDER[previousLevel] ? 'down' : 'same'

      let alert = null
      let suppressed = null

      if (RISK_LEVEL_ORDER[targetLevel] >= RISK_LEVEL_ORDER[RISK_LEVEL.WARN]) {
        const cooldown = thresholds[targetLevel]?.cooldownMs ?? 0
        const withinCooldown = current.lastAlertAt != null && current.lastAlertLevel === targetLevel
          && (now - current.lastAlertAt) < cooldown

        if (withinCooldown) {
          suppressed = {
            level: targetLevel,
            remainMs: cooldown - (now - current.lastAlertAt),
            detail: `同档位告警处于冷却期，剩余 ${Math.ceil((cooldown - (now - current.lastAlertAt)) / 60000)} 分钟不重复推送`,
          }
        } else {
          const reason = match.breach ? TRIGGER_REASONS.OCCUPANCY : TRIGGER_REASONS.TREND
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
            evidence: buildCrowdEvidence({ reading, match, thresholds, trendTrigger, dwellCount: current.dwellCount }),
          }
          current.lastAlertAt = now
          current.lastAlertLevel = targetLevel
        }
      }

      let release = null
      if (previousLevel !== RISK_LEVEL.NORMAL && targetLevel === RISK_LEVEL.NORMAL) {
        release = {
          locationId: reading.locationId,
          name: reading.name,
          fromLevel: previousLevel,
          ratio: reading.ratio,
          detail: `占用率回落至 ${(reading.ratio * 100).toFixed(1)}%，已跌破${RISK_LEVEL_LABELS[previousLevel]}档下降沿` +
            ` ${((thresholds[previousLevel]?.down ?? 0) * 100).toFixed(0)}%，风险解除`,
        }
      }

      current.level = targetLevel
      if (targetLevel === RISK_LEVEL.NORMAL) current.dwellCount = 0

      return {
        locationId: reading.locationId, level: targetLevel, previousLevel,
        changed: targetLevel !== previousLevel, direction, thresholds,
        dwellCount: current.dwellCount, alert, suppressed, release,
      }
    },

    acknowledge(locationId, at = 0) {
      const current = getState(locationId)
      current.lastAlertAt = at
      current.lastAlertLevel = current.level
      return { locationId, level: current.level, acknowledgedAt: at }
    },

    peek(locationId) {
      const current = state.get(locationId)
      return current ? { ...current, history: [...current.history] } : { locationId, level: RISK_LEVEL.NORMAL, history: [] }
    },

    listActive() {
      return [...state.entries()]
        .filter(([, value]) => RISK_LEVEL_ORDER[value.level] >= RISK_LEVEL_ORDER[RISK_LEVEL.WARN])
        .map(([locationId, value]) => ({ locationId, level: value.level, latest: value.history.at(-1) ?? null }))
    },

    reset() { state.clear() },
  }
}

function buildCrowdEvidence({ reading, match, thresholds, trendTrigger, dwellCount }) {
  const sensitivity = getPlaceSensitivity(reading.placeKind)
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
    detail: `${reading.name}（${reading.placeKind}）敏感度 ×${sensitivity.weight} —— ${sensitivity.reason}`,
  })
  return evidence
}

/**
 * ★ 空间传播 —— 人流溢出是空间相关的：食堂拥挤必然带动相邻路口
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

          const propagatedOrder = Math.max(1, Math.min(RISK_LEVEL_ORDER[source.level] - hop, RISK_LEVEL_ORDER.high))
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

  const strongest = new Map()
  for (const item of propagated) {
    const existing = strongest.get(item.locationId)
    if (!existing || RISK_LEVEL_ORDER[item.level] > RISK_LEVEL_ORDER[existing.level]) strongest.set(item.locationId, item)
  }

  return {
    propagated: [...strongest.values()],
    detail: `邻接表覆盖 ${Object.keys(adjacency).length} 个地点，产出 ${strongest.size} 条传导预警`,
  }
}

export function summarizeRiskLevels(items = []) {
  const counts = { normal: 0, warn: 0, high: 0, critical: 0 }
  for (const item of items) if (counts[item.level] != null) counts[item.level] += 1
  const highest = ['critical', 'high', 'warn', 'normal'].find((level) => counts[level] > 0) ?? 'normal'
  return {
    counts, total: items.length, highest,
    summary: `严重 ${counts.critical} · 高风险 ${counts.high} · 关注 ${counts.warn} · 正常 ${counts.normal}`,
  }
}

// ===========================================================================
// 二、预警分级矩阵与状态机
// ===========================================================================

export const SEVERITY = Object.freeze({
  INFO: 'info', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical',
})

export const SEVERITY_LABELS = Object.freeze({
  info: '提示', low: '低', medium: '中', high: '高', critical: '紧急',
})

export const SEVERITY_ORDER = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 })

export const SEVERITY_COLORS = Object.freeze({
  info: '#5b8def', low: '#6f9f68', medium: '#dca05a', high: '#ca704a', critical: '#c9685e',
})

/**
 * ★ 事件类型 → 基础严重度
 * 同时覆盖 CampusTwin 现有的 `activity | crowd | construction` 与安全管理模式的
 * `safety | traffic | service | notice | help`，两套类型都能定级。
 */
export const TYPE_BASE_SEVERITY = Object.freeze({
  // CampusTwin 现有类型
  construction: SEVERITY.MEDIUM,
  crowd: SEVERITY.MEDIUM,
  activity: SEVERITY.INFO,
  // 安全管理模式类型
  safety: SEVERITY.HIGH,
  traffic: SEVERITY.MEDIUM,
  service: SEVERITY.LOW,
  notice: SEVERITY.INFO,
  help: SEVERITY.LOW,
})

export const TYPE_BASE_REASONS = Object.freeze({
  construction: '施工类事件影响通行，基础定级为「中」',
  crowd: '人流类事件涉及聚集风险，基础定级为「中」',
  activity: '活动类事件为信息传达，基础定级为「提示」',
  safety: '安全类事件直接涉及人身安全，基础定级为「高」',
  traffic: '通行类事件影响流动效率，基础定级为「中」',
  service: '服务类事件影响体验但不涉安全，基础定级为「低」',
  notice: '通知类事件为信息传达，基础定级为「提示」',
  help: '互助类事件为自发协作，基础定级为「低」',
})

export const NIGHT_HOURS = Object.freeze({ start: 22, end: 6 })

export const SLA_TABLE = Object.freeze({
  critical: Object.freeze({ responseMinutes: 3, escalateTo: ['保卫处值班', '校领导'], label: '3 分钟', channel: ['推送', '大屏闪烁', '值班电话'] }),
  high: Object.freeze({ responseMinutes: 15, escalateTo: ['保卫处值班'], label: '15 分钟', channel: ['推送', '大屏常驻'] }),
  medium: Object.freeze({ responseMinutes: 60, escalateTo: ['后勤', '属地管理员'], label: '60 分钟', channel: ['推送'] }),
  low: Object.freeze({ responseMinutes: 24 * 60, escalateTo: [], label: '24 小时', channel: ['信息流'] }),
  info: Object.freeze({ responseMinutes: 0, escalateTo: [], label: '不限时', channel: ['信息流'] }),
})

export const ALERT_STATE = Object.freeze({
  REPORTED: 'reported', EXTRACTING: 'extracting', PENDING: 'pending', VERIFYING: 'verifying',
  PUBLISHED: 'published', DISPATCHED: 'dispatched', RESOLVED: 'resolved', CLOSED: 'closed',
  CONTRADICTED: 'contradicted', REJECTED: 'rejected',
})

export const ALERT_STATE_LABELS = Object.freeze({
  reported: '已上报', extracting: '抽取中', pending: '待核查', verifying: '待核实',
  published: '已发布', dispatched: '已派单', resolved: '已处置', closed: '已结束',
  contradicted: '证据矛盾', rejected: '已驳回',
})

export const ALERT_TRANSITIONS = Object.freeze({
  reported: ['extracting'],
  extracting: ['pending'],
  pending: ['published', 'verifying', 'rejected'],
  verifying: ['published', 'rejected'],
  published: ['dispatched', 'contradicted', 'closed'],
  dispatched: ['resolved', 'contradicted'],
  resolved: ['closed', 'contradicted'],
  contradicted: ['closed', 'published'],
  rejected: ['closed'],
  closed: [],
})

export const CREDIBILITY = Object.freeze({ DEFAULT_THRESHOLD: 0.65, SAFETY_THRESHOLD: 0.75 })

export function canTransition(from, to) {
  const allowed = ALERT_TRANSITIONS[from] ?? []
  return {
    allowed: allowed.includes(to),
    detail: allowed.includes(to)
      ? `${ALERT_STATE_LABELS[from]} → ${ALERT_STATE_LABELS[to]} 合法`
      : `${ALERT_STATE_LABELS[from] ?? from} 不能直接迁移到 ${ALERT_STATE_LABELS[to] ?? to}`,
  }
}

export function isNightTime(ts, hours = NIGHT_HOURS) {
  const hour = new Date(ts).getHours()
  const { start, end } = hours
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end)
}

/**
 * ★ 预警分级矩阵：严重度 × 场所敏感度 × 时段权重
 * 把「AI 分类」和「校园空间知识」真正接起来 —— 同样的火情，宿舍楼和操场不是一个级别。
 */
export function gradeAlert(event, context = {}) {
  const at = context.at ?? context.now ?? (event?.ts ? new Date(event.ts).getTime() : 0)
  const type = event?.type ?? 'notice'
  const locationId = event?.locationId ?? event?.anchorId ?? null
  const place = context.place ?? PLACE_CAPACITY[locationId] ?? null
  const placeKind = context.placeKind ?? place?.kind ?? 'plaza'
  const placeName = place?.name ?? locationId ?? '未知地点'

  const evidence = []
  let order = SEVERITY_ORDER[TYPE_BASE_SEVERITY[type] ?? SEVERITY.LOW]
  const baseOrder = order
  evidence.push({
    label: '事件类型定级',
    detail: `${type} → 基础档「${SEVERITY_LABELS[TYPE_BASE_SEVERITY[type] ?? SEVERITY.LOW]}」· ${TYPE_BASE_REASONS[type] ?? '未配置类型'}`,
  })

  const sensitivity = getPlaceSensitivity(placeKind)
  const sensitivityScore = (order + 1) * sensitivity.weight
  const afterPlace = Math.max(0, Math.min(SEVERITY_ORDER.critical, Math.round(sensitivityScore) - 1))
  const levelName = (value) => SEVERITY_LABELS[Object.keys(SEVERITY_ORDER).find((k) => SEVERITY_ORDER[k] === value)]
  evidence.push({
    label: '场所敏感度',
    detail: `${placeName}（${placeKind}）敏感度 ×${sensitivity.weight}，敏感度分值 ${sensitivityScore.toFixed(1)} —— ${sensitivity.reason}` +
      (afterPlace !== baseOrder ? `，档位由「${levelName(baseOrder)}」上调至「${levelName(afterPlace)}」` : '，档位不变'),
  })

  const night = isNightTime(at)
  let finalOrder = afterPlace
  // ★ 夜间升档必须覆盖**最低档**：`info`(0) 也要能升到 `low`(1)。
  //   早期版本多写了一个 `finalOrder >= SEVERITY_ORDER.low` 的守卫，
  //   导致最低档在夜间永远升不上去 —— 而"通知类事件夜里没人看"正是
  //   最需要升档的场景，这个守卫把升档机制在低风险侧整段废掉了。
  if (night && finalOrder < SEVERITY_ORDER.critical) {
    finalOrder += 1
    evidence.push({
      label: '时段权重',
      detail: `事发时刻 ${formatHour(at)} 属夜间时段（${NIGHT_HOURS.start}:00–${NIGHT_HOURS.end}:00），同级别自动升档至「${levelName(finalOrder)}」—— 夜间处置资源少、视野差`,
    })
  } else {
    evidence.push({
      label: '时段权重',
      detail: night ? '夜间时段，但已处最高档，不再上调' : `事发时刻 ${formatHour(at)} 属日间时段，不升档`,
    })
  }

  const level = Object.keys(SEVERITY_ORDER).find((key) => SEVERITY_ORDER[key] === finalOrder)
  const sla = SLA_TABLE[level]

  return {
    eventId: event?.id ?? null, type, locationId, placeName, placeKind,
    level, levelLabel: SEVERITY_LABELS[level], levelOrder: finalOrder,
    color: SEVERITY_COLORS[level], night, sensitivity,
    sensitivityScore: Math.round(sensitivityScore * 10) / 10,
    sla: { ...sla, dueAt: sla.responseMinutes > 0 ? at + sla.responseMinutes * 60000 : null },
    escalated: finalOrder > baseOrder,
    escalateReason: finalOrder > baseOrder
      ? `分级由基础档上调 ${finalOrder - baseOrder} 档（${[sensitivity.weight > 1 ? `场所敏感度 ×${sensitivity.weight}` : null, night ? '夜间时段' : null].filter(Boolean).join(' + ')}）`
      : null,
    evidence,
  }
}

function formatHour(ts) {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** ★ 可信度闸门 —— 安全类强制走人工审核（发布错误的安全预警要担责） */
export function applyCredibilityGate(event) {
  const type = event?.type ?? 'notice'
  const score = event?.ai?.credibility?.score ?? null
  const isSafety = type === 'safety'
  const threshold = isSafety ? CREDIBILITY.SAFETY_THRESHOLD : CREDIBILITY.DEFAULT_THRESHOLD

  if (score == null) {
    return { passed: false, state: ALERT_STATE.PENDING, gate: 'no-score', score: null, threshold, detail: '尚无可信度评分，停留「待核查」' }
  }
  const passed = score >= threshold
  return {
    passed,
    state: passed ? ALERT_STATE.PUBLISHED : isSafety ? ALERT_STATE.VERIFYING : ALERT_STATE.PENDING,
    gate: isSafety ? 'safety-mandatory' : 'default',
    score, threshold,
    detail: passed
      ? `可信度 ${(score * 100).toFixed(0)}% ≥ 阈值 ${(threshold * 100).toFixed(0)}%，自动发布`
      : `可信度 ${(score * 100).toFixed(0)}% < 阈值 ${(threshold * 100).toFixed(0)}%，` +
        (isSafety
          ? '★ 安全类强制闸门生效：进人工审核队列，前端只显示「待核实」、灰色虚标不打点'
          : '进人工审核队列，等待补充证据'),
  }
}

export function createAlert(event, grading, options = {}) {
  const at = event?.ts ? new Date(event.ts).getTime() : (options.now ?? 0)
  return {
    id: `alert:${event?.id ?? Math.random().toString(36).slice(2, 10)}`,
    eventId: event?.id ?? null,
    type: event?.type ?? 'notice',
    title: event?.title ?? event?.text ?? '未命名事件',
    locationId: grading?.locationId ?? event?.locationId ?? null,
    placeName: grading?.placeName ?? null,
    placeKind: grading?.placeKind ?? null,
    level: grading?.level ?? SEVERITY.LOW,
    levelLabel: grading?.levelLabel ?? SEVERITY_LABELS.low,
    color: grading?.color ?? SEVERITY_COLORS.low,
    state: ALERT_STATE.REPORTED,
    credibility: event?.ai?.credibility ?? null,
    sla: grading?.sla ?? SLA_TABLE.low,
    escalated: grading?.escalated ?? false,
    escalateReason: grading?.escalateReason ?? null,
    raisedAt: at,
    timeline: [{ at, state: ALERT_STATE.REPORTED, label: '上报', detail: '用户在地图上选点并提交一句话描述' }],
    dispatches: [],
    evidence: grading?.evidence ?? [],
    affectedEdgeIds: event?.affectedEdgeIds ?? [],
  }
}

/** 推进预警状态机（含侧效应声明：封路 / 解封 / 派单 / 归档） */
export function advanceAlert(alert, nextState, meta = {}) {
  const transition = canTransition(alert.state, nextState)
  if (!transition.allowed) return { alert, transition, sideEffects: [], error: transition.detail }

  const at = meta.at ?? alert.raisedAt ?? 0
  const sideEffects = []
  const next = {
    ...alert,
    state: nextState,
    timeline: [...alert.timeline, {
      at, state: nextState, label: ALERT_STATE_LABELS[nextState],
      detail: meta.detail ?? transition.detail, actor: meta.actor ?? '系统',
    }],
  }

  if (nextState === ALERT_STATE.DISPATCHED && meta.dispatch) {
    next.dispatches = [...next.dispatches, { ...meta.dispatch, at, status: 'dispatched' }]
    sideEffects.push(`派单给「${meta.dispatch.role}」：${meta.dispatch.task}`)
  }
  if (nextState === ALERT_STATE.PUBLISHED) {
    sideEffects.push('写入信息流 + 地图打点')
    if (isBlockingEvent(alert)) sideEffects.push('affectedEdgeIds 生效（触发 A* 重算与路线对比渲染）')
  }
  if (nextState === ALERT_STATE.CLOSED || nextState === ALERT_STATE.CONTRADICTED) {
    if (isBlockingEvent(alert)) sideEffects.push('affectedEdgeIds 解除（路线自动恢复）')
    sideEffects.push('归档，形成本次事件的处置记录')
  }
  if (nextState === ALERT_STATE.VERIFYING) {
    sideEffects.push('★ 灰色虚标、不打点，仅进人工审核队列（安全类强制闸门）')
  }
  if (nextState === ALERT_STATE.RESOLVED && next.dispatches.length) {
    next.dispatches = next.dispatches.map((item) => ({ ...item, status: 'resolved', resolvedAt: at }))
    sideEffects.push('处置结果回写，用于统计响应时长与闭环率')
  }

  return { alert: next, transition, sideEffects, error: null }
}

/**
 * 是否属于「影响通行」的事件（决定是否联动封路）
 * ★ 判定必须**保守**：漏封一条路的代价，远小于因为一条普通报修就莫名封路。
 */
export const BLOCKING_KEYWORDS = Object.freeze([
  '挡路', '占用', '封闭', '无法通行', '过不去', '封路', '积水', '塌陷', '塌方', '堵死', '断交', '施工', '维护',
])

export function isBlockingEvent(alert) {
  if (alert?.affectedEdgeIds?.length) return true
  const text = `${alert?.title ?? ''}${alert?.text ?? ''}${alert?.impact ?? ''}`
  if (BLOCKING_KEYWORDS.some((word) => text.includes(word))) return true
  return alert?.type === 'traffic' || alert?.type === 'construction'
}

export function checkSla(alert, now) {
  const dueAt = alert?.sla?.dueAt
  const escalateTo = alert?.sla?.escalateTo ?? []
  if (dueAt == null) return { overdue: false, remainMs: Infinity, overdueMs: 0, escalateTo, detail: '该等级不设响应时限' }

  const settled = [ALERT_STATE.RESOLVED, ALERT_STATE.CLOSED, ALERT_STATE.REJECTED].includes(alert.state)
  const remainMs = dueAt - now
  if (settled) {
    const dispatched = alert.timeline.find((item) => item.state === ALERT_STATE.DISPATCHED)
    const actual = (dispatched?.at ?? now) - alert.raisedAt
    return { overdue: false, remainMs, overdueMs: 0, escalateTo, detail: `已进入处置流，响应时长 ${Math.max(0, Math.round(actual / 60000))} 分钟` }
  }
  if (remainMs < 0) {
    return {
      overdue: true, remainMs, overdueMs: -remainMs, escalateTo,
      detail: `★ 超出响应时限 ${Math.round(-remainMs / 60000)} 分钟，应升级至：${escalateTo.join('、') || '无升级对象'}`,
    }
  }
  return { overdue: false, remainMs, overdueMs: 0, escalateTo, detail: `剩余响应时间 ${Math.round(remainMs / 60000)} 分钟` }
}

/** ★ 处置时效 —— 有响应时间，才证明闭环真的闭合了 */
export function summarizeResponseTimes(alerts = []) {
  const responseMinutes = []
  let overdueCount = 0
  let closedCount = 0

  for (const alert of alerts) {
    const dispatched = alert.timeline?.find((item) => item.state === ALERT_STATE.DISPATCHED)
    const closed = alert.timeline?.find((item) => item.state === ALERT_STATE.CLOSED)
    if (dispatched) responseMinutes.push(Math.max(0, (dispatched.at - alert.raisedAt) / 60000))
    if (closed) closedCount += 1
    if (alert.sla?.dueAt != null && dispatched && dispatched.at > alert.sla.dueAt) overdueCount += 1
  }

  const avg = responseMinutes.length ? responseMinutes.reduce((s, v) => s + v, 0) / responseMinutes.length : null
  const overdueRate = responseMinutes.length ? Math.round((overdueCount / responseMinutes.length) * 1000) / 10 : 0
  const closureRate = alerts.length ? Math.round((closedCount / alerts.length) * 1000) / 10 : 0

  return {
    total: alerts.length,
    dispatchedCount: responseMinutes.length,
    closedCount, overdueCount,
    avgResponseMinutes: avg == null ? null : Math.round(avg * 10) / 10,
    overdueRate, closureRate,
    summary: avg == null
      ? '暂无已派单预警，无法计算平均响应时长'
      : `平均响应 ${Math.round(avg * 10) / 10} 分钟 · 超时率 ${overdueRate}% · 闭环率 ${closureRate}%`,
  }
}

// ===========================================================================
// 三、处置预案（六个预案 · 八个动作原子）
// ===========================================================================

export const ACTION_CODES = Object.freeze({
  BROADCAST: 'broadcast', BLOCK_EDGE: 'block-edge', REROUTE: 'reroute', DISPATCH: 'dispatch',
  CLOSE_PLACE: 'close-place', HIGHLIGHT_ROUTE: 'highlight-route', PAUSE_OUTDOOR: 'pause-outdoor', LOG_EVIDENCE: 'log-evidence',
})

export const ACTION_LABELS = Object.freeze({
  broadcast: { label: '定向广播', detail: '向指定范围推送一句话提示' },
  'block-edge': { label: '路段封闭', detail: '将路段写入 affectedEdgeIds，触发 A* 重算' },
  reroute: { label: '路线重算', detail: '重算受影响路线并渲染新旧对比' },
  dispatch: { label: '派单', detail: '生成任务卡并推送给责任人，带响应时限' },
  'close-place': { label: '关闭场所', detail: '将场所状态置为 closed，地图标记封闭' },
  'highlight-route': { label: '高亮路线', detail: '高亮推荐通行路线（如环廊避雨通道）' },
  'pause-outdoor': { label: '暂停户外活动', detail: '暂停体育课、军训、社团等户外安排' },
  'log-evidence': { label: '留痕', detail: '记录处置过程，形成可审计的时间线' },
})

/** 动作执行的确定性顺序：先隔离风险，再改路线，最后通知 */
export const ACTION_ORDER = Object.freeze([
  ACTION_CODES.BLOCK_EDGE, ACTION_CODES.CLOSE_PLACE, ACTION_CODES.PAUSE_OUTDOOR,
  ACTION_CODES.REROUTE, ACTION_CODES.HIGHLIGHT_ROUTE, ACTION_CODES.DISPATCH,
  ACTION_CODES.BROADCAST, ACTION_CODES.LOG_EVIDENCE,
])

export const PLAYBOOK_KIND = Object.freeze({
  CROWD_OVERFLOW: 'crowd-overflow', ROAD_BLOCKED: 'road-blocked', RAINSTORM: 'rainstorm',
  HAIL: 'hail', HEAT: 'heat', BIG_EVENT: 'big-event',
})

export const PLAYBOOK_LABELS = Object.freeze({
  'crowd-overflow': '人流超限分流预案', 'road-blocked': '道路占用处置预案',
  rainstorm: '暴雨应急联动预案', hail: '冰雹避险预案',
  heat: '高温防护预案', 'big-event': '大型活动散场预案',
})

const PLAYBOOK_DEFS = {
  [PLAYBOOK_KIND.CROWD_OVERFLOW]: {
    label: PLAYBOOK_LABELS['crowd-overflow'],
    trigger: '人流占用率达到高风险档并完成驻留确认',
    level: SEVERITY.HIGH, routeMode: 'shortest',
    steps: [
      { action: ACTION_CODES.BROADCAST, target: '该地点周边 300 m', params: { text: '此处人流已达安全上限，建议前往就近替代场所或等候 10 分钟错峰' }, note: '分流提示要给出**具体去处**，否则用户不会执行' },
      { action: ACTION_CODES.HIGHLIGHT_ROUTE, target: '就近替代地点', params: { mode: 'shortest' }, note: '同时高亮替代路线，把"建议"变成"可点的一步"' },
      { action: ACTION_CODES.DISPATCH, target: '保安', params: { role: '保安', count: 2, task: '现场分流，引导排队队伍不占用车道' }, note: '人流超限的真正风险往往是**溢出到车道**' },
      { action: ACTION_CODES.LOG_EVIDENCE, target: '该地点', params: { template: '人流超限处置记录' }, note: '留痕用于事后统计与责任界定' },
    ],
  },
  [PLAYBOOK_KIND.ROAD_BLOCKED]: {
    label: PLAYBOOK_LABELS['road-blocked'],
    trigger: '通行类事件可信度通过并发布',
    level: SEVERITY.MEDIUM,
    steps: [
      { action: ACTION_CODES.BLOCK_EDGE, target: '事发路段', params: { edgeId: '$edgeId' }, note: '★ 复用现有 affectedEdgeIds 机制，aStar() 一行不改' },
      { action: ACTION_CODES.REROUTE, target: '受影响路线', params: { showCompare: true }, note: '渲染原路线 + 新路线对比' },
      { action: ACTION_CODES.DISPATCH, target: '后勤', params: { role: '后勤', task: '现场核实并清障' }, note: '派单带响应时限，超时自动升级' },
      { action: ACTION_CODES.BROADCAST, target: '途经该路段用户', params: { text: '$edgeLabel 暂时无法通行，已为你重新规划路线' }, note: '广播文案含具体路段名' },
    ],
  },
  [PLAYBOOK_KIND.RAINSTORM]: {
    label: PLAYBOOK_LABELS.rainstorm, trigger: '暴雨橙色或红色预警',
    level: SEVERITY.HIGH, routeMode: 'rain',
    steps: [
      { action: ACTION_CODES.BLOCK_EDGE, target: '低洼路段', params: { edges: LOW_LYING_EDGES }, note: '低洼路段积水风险最高，先隔离再疏导' },
      { action: ACTION_CODES.CLOSE_PLACE, target: '地下车库入口', params: { places: ['下沉广场', '智谷谷底'], reason: '暴雨倒灌风险' }, note: '倒灌损失远大于临时封闭的不便' },
      { action: ACTION_CODES.PAUSE_OUTDOOR, target: '全校户外活动', params: { scope: '户外', reason: '暴雨预警' }, note: '体育课、军训、社团活动一并暂停' },
      { action: ACTION_CODES.HIGHLIGHT_ROUTE, target: '环廊避雨通道', params: { mode: 'rain', edges: COVERED_ROUTE_EDGES }, note: '★ 复用已有 ROUTE_MODES.RAIN，零新增代码' },
      { action: ACTION_CODES.DISPATCH, target: '后勤', params: { role: '后勤', task: '排查低洼路段积水与排水口堵塞情况' }, note: '预警落到具体任务才算闭环' },
      { action: ACTION_CODES.BROADCAST, target: '全校', params: { text: '暴雨预警生效，请优先使用环廊避雨通道，避开低洼路段' }, note: '一句话给出可执行动作，而非复述气象级别' },
    ],
  },
  [PLAYBOOK_KIND.HAIL]: {
    label: PLAYBOOK_LABELS.hail, trigger: '冰雹橙色或红色预警', level: SEVERITY.HIGH,
    steps: [
      { action: ACTION_CODES.CLOSE_PLACE, target: '露天球场', params: { places: ['体育场'], reason: '冰雹直接伤害风险' }, note: '冰雹对露天场地的人是直接人身伤害' },
      { action: ACTION_CODES.HIGHLIGHT_ROUTE, target: '教学楼门厅', params: { mode: 'shortest', destination: 'teaching-a' }, note: '给出去处：门厅、食堂、图书馆均为避险点' },
      { action: ACTION_CODES.BROADCAST, target: '全校', params: { text: '冰雹预警，请立即就近进入教学楼门厅或食堂避险，勿在露天停留' }, note: '"立即就近"是关键措辞' },
      { action: ACTION_CODES.DISPATCH, target: '后勤', params: { role: '后勤', task: '检查自行车棚与临时围挡受损情况' }, note: '冰雹后必然有设施损坏，提前派核查任务' },
    ],
  },
  [PLAYBOOK_KIND.HEAT]: {
    label: PLAYBOOK_LABELS.heat, trigger: '高温橙色或红色预警', level: SEVERITY.MEDIUM, routeMode: 'shade',
    steps: [
      { action: ACTION_CODES.PAUSE_OUTDOOR, target: '体测 / 军训 / 户外课', params: { scope: '户外课程与训练', reason: '高温中暑风险' }, note: '★ 教育场景独有的动作' },
      { action: ACTION_CODES.BROADCAST, target: '全校', params: { text: '高温预警，请避开 11:00–15:00 户外活动，就近补水点位于各教学楼门厅' }, note: '给出时间窗与具体地点' },
      { action: ACTION_CODES.HIGHLIGHT_ROUTE, target: '阴凉路线', params: { mode: 'shade' }, note: '优先有树荫与连廊的边' },
      { action: ACTION_CODES.DISPATCH, target: '校医院', params: { role: '校医院', task: '备勤防暑物资并在运动区巡诊' }, note: '高温风险集中在运动区与户外课程时段' },
    ],
  },
  [PLAYBOOK_KIND.BIG_EVENT]: {
    label: PLAYBOOK_LABELS['big-event'], trigger: '报备的大型活动临近散场', level: SEVERITY.MEDIUM,
    steps: [
      { action: ACTION_CODES.HIGHLIGHT_ROUTE, target: '多向疏散路线', params: { mode: 'shortest', multiPath: true }, note: '★ 普通导航只做"我怎么去"，安全系统还要做"大家怎么撤"' },
      { action: ACTION_CODES.BROADCAST, target: '活动参与人员', params: { text: '活动即将结束，请按引导分东、南、西三个方向离场，避免全部涌向主校门' }, note: '把人流按方向劈开，是散场管理的核心动作' },
      { action: ACTION_CODES.DISPATCH, target: '保安', params: { role: '保安', count: 4, task: '在三个方向出口引导分流' }, note: '分流的关键在于出口处有人' },
      { action: ACTION_CODES.LOG_EVIDENCE, target: '活动现场', params: { template: '大型活动散场记录' }, note: '散场记录可用于下次活动的容量评估' },
    ],
  },
}

export const PLAYBOOKS = Object.freeze(Object.fromEntries(
  Object.entries(PLAYBOOK_DEFS).map(([kind, def]) => [kind, Object.freeze({
    kind, label: def.label, trigger: def.trigger, defaultLevel: def.level, routeMode: def.routeMode ?? null,
    steps: Object.freeze(def.steps.map((step) => Object.freeze(step))),
  })]),
))

/** 实例化预案：把模板里的 `$变量` 替换成具体值，并按确定性顺序排列 */
export function instantiatePlaybook(kind, context = {}, options = {}) {
  const template = PLAYBOOKS[kind]
  if (!template) return null

  const level = options.level ?? template.defaultLevel
  const now = options.now ?? 0
  const sla = SLA_TABLE[level] ?? SLA_TABLE.medium
  const unresolved = []

  const steps = template.steps.map((step, index) => {
    const { params, missing } = substituteParams(step.params, context)
    missing.forEach((key) => unresolved.push(`${step.action}:${key}`))
    return {
      id: `${kind}:step-${index + 1}`,
      order: ACTION_ORDER.indexOf(step.action),
      action: step.action,
      actionLabel: ACTION_LABELS[step.action]?.label ?? step.action,
      target: substituteString(step.target, context),
      params, note: step.note, status: 'pending', missing,
    }
  }).sort((a, b) => a.order - b.order)

  return {
    kind, label: template.label, trigger: template.trigger, level,
    routeMode: template.routeMode,
    sla: { ...sla, dueAt: sla.responseMinutes > 0 ? now + sla.responseMinutes * 60000 : null },
    steps, unresolved,
    summary: `启动「${template.label}」（${SEVERITY_LABELS[level]} 级）：共 ${steps.length} 个动作 —— ` +
      steps.map((s) => s.actionLabel).join(' + '),
  }
}

function substituteString(text, context) {
  if (typeof text !== 'string') return text
  return text.replace(/\$(\w+)/g, (match, key) => (context[key] != null ? String(context[key]) : match))
}

function substituteParams(params, context) {
  const missing = []
  const walk = (value) => {
    if (typeof value === 'string') {
      return value.replace(/\$(\w+)/g, (match, key) => {
        if (context[key] != null) return String(context[key])
        missing.push(key)
        return match
      })
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    return value
  }
  return { params: walk(params), missing: [...new Set(missing)] }
}

/** ★ 一键执行（支持逐项与整体撤销）—— 只产出变更集，由调用方落到状态上 */
export function executePlaybook(instance, options = {}) {
  const { at = 0, undo = false, only = null } = options
  const applied = []
  const skipped = []

  for (const step of instance?.steps ?? []) {
    if (only && !only.includes(step.action)) { skipped.push({ id: step.id, action: step.action, reason: '未被选中执行' }); continue }
    if (step.missing?.length) { skipped.push({ id: step.id, action: step.action, reason: `缺少变量：${step.missing.join('、')}` }); continue }

    // ★ 必须回写原始步骤对象的 status：调用方依赖它重算派生状态，
    //   只放进返回副本会导致"该解除的没解除"。
    step.status = undo ? 'reverted' : 'done'
    step.executedAt = at
    applied.push({ ...step })
  }

  const edgeIdsOf = (steps) => [...new Set(steps
    .filter((s) => s.action === ACTION_CODES.BLOCK_EDGE)
    .flatMap((s) => [s.params.edgeId, ...(s.params.edges ?? [])]).filter(Boolean))]

  const changes = {
    blockedEdgesAdd: undo ? [] : edgeIdsOf(applied),
    blockedEdgesRemove: undo ? edgeIdsOf(instance?.steps ?? []) : [],
    closedPlaces: undo ? [] : [...new Set(applied.filter((s) => s.action === ACTION_CODES.CLOSE_PLACE).flatMap((s) => s.params.places ?? [s.params.place]).filter(Boolean))],
    reopenedPlaces: undo ? [...new Set((instance?.steps ?? []).filter((s) => s.action === ACTION_CODES.CLOSE_PLACE).flatMap((s) => s.params.places ?? [s.params.place]).filter(Boolean))] : [],
    routeMode: undo ? null : (applied.find((s) => s.action === ACTION_CODES.HIGHLIGHT_ROUTE)?.params.mode ?? null),
    reroute: !undo && applied.some((s) => s.action === ACTION_CODES.REROUTE),
    showCompare: !undo && applied.some((s) => s.action === ACTION_CODES.REROUTE && s.params.showCompare),
    dispatches: undo ? [] : applied.filter((s) => s.action === ACTION_CODES.DISPATCH)
      .map((s) => ({ role: s.params.role, task: s.params.task, count: s.params.count ?? 1 })),
    broadcasts: undo ? [] : applied.filter((s) => s.action === ACTION_CODES.BROADCAST).map((s) => s.params.text),
    outdoorPaused: !undo && applied.some((s) => s.action === ACTION_CODES.PAUSE_OUTDOOR),
    evidence: applied.filter((s) => s.action === ACTION_CODES.LOG_EVIDENCE).map((s) => s.params.template),
    shelters: applied.filter((s) => s.action === ACTION_CODES.HIGHLIGHT_ROUTE).flatMap((s) => s.params.edges ?? []),
  }

  return {
    applied, skipped, changes,
    undoToken: `${instance?.kind ?? 'unknown'}@${at}`,
    summary: undo
      ? `已撤销「${instance?.label ?? ''}」：解除 ${changes.blockedEdgesRemove.length} 段封路，恢复 ${changes.reopenedPlaces.length} 个场所，路线自动恢复`
      : `已执行「${instance?.label ?? ''}」：${applied.length} 个动作生效` +
        (skipped.length ? `，${skipped.length} 个被跳过` : '') +
        ` —— ${changes.blockedEdgesAdd.length} 段封路 / ${changes.dispatches.length} 个派单 / ${changes.broadcasts.length} 条广播`,
  }
}

/** 根据态势自动选择预案 */
export function selectPlaybook(input = {}) {
  const { crowdRiskLevel, weatherKind, blocking, bigEvent } = input
  if (weatherKind === 'rainstorm') return { kind: PLAYBOOK_KIND.RAINSTORM, reason: '暴雨预警 → 暴雨应急联动预案' }
  if (weatherKind === 'hail') return { kind: PLAYBOOK_KIND.HAIL, reason: '冰雹预警 → 冰雹避险预案' }
  if (weatherKind === 'heat') return { kind: PLAYBOOK_KIND.HEAT, reason: '高温预警 → 高温防护预案' }
  if (bigEvent) return { kind: PLAYBOOK_KIND.BIG_EVENT, reason: '大型活动散场 → 散场分流预案' }
  if (blocking) return { kind: PLAYBOOK_KIND.ROAD_BLOCKED, reason: '事件影响通行 → 道路占用处置预案' }
  if (crowdRiskLevel === 'high' || crowdRiskLevel === 'critical') {
    return { kind: PLAYBOOK_KIND.CROWD_OVERFLOW, reason: `人流风控「${crowdRiskLevel}」→ 人流超限分流预案` }
  }
  return { kind: null, reason: '当前态势不需要启动预案（风险未达阈值）' }
}

/**
 * 构造地点邻接表（供空间传播使用）
 * 依据路网真实连接关系手工标注「人流会互相影响」的地点对。
 */
export const CAMPUS_ADJACENCY = Object.freeze({
  canteen: ['commercial-street', 'library', 'teaching-a'],
  'commercial-street': ['canteen', 'dormitory', 'dorm-b'],
  library: ['canteen', 'teaching-a', 'valley'],
  'teaching-a': ['teaching-b', 'teaching-c', 'library', 'canteen'],
  'teaching-b': ['teaching-a', 'teaching-c', 'student-center'],
  'teaching-c': ['teaching-a', 'teaching-b', 'teaching-d'],
  'teaching-d': ['teaching-c', 'lab-a', 'lab-b'],
  dormitory: ['dorm-b', 'commercial-street', 'canteen'],
  'dorm-b': ['dormitory', 'dorm-d', 'commercial-street'],
  'dorm-d': ['dorm-b', 'dorm-e', 'graduate-apartment'],
  'dorm-e': ['dorm-d', 'dorm-f', 'graduate-apartment'],
  'dorm-f': ['dorm-e', 'graduate-apartment'],
  'graduate-apartment': ['dorm-e', 'dorm-f', 'dorm-d'],
  gymnasium: ['stadium', 'student-center', 'hospital'],
  stadium: ['gymnasium', 'hospital'],
  hospital: ['gymnasium', 'stadium'],
  'east-gate': ['valley', 'commercial-street'],
  valley: ['east-gate', 'library', 'student-center'],
  'student-center': ['valley', 'gymnasium', 'teaching-b'],
  'lab-a': ['lab-b', 'teaching-d', 'research-center'],
  'lab-b': ['lab-a', 'research-center'],
  'research-center': ['lab-a', 'lab-b', 'innovation-center'],
  'innovation-center': ['research-center', 'maker-workshop', 'vertical-college'],
  'maker-workshop': ['innovation-center'],
  'vertical-college': ['innovation-center', 'lecture-hall'],
  'lecture-hall': ['vertical-college', 'performing-arts'],
  'performing-arts': ['lecture-hall', 'student-center'],
  'ring-s1': ['dorm-e', 'dorm-d'],
  'ring-s4': ['library', 'teaching-a'],
  'ring-s7': ['teaching-c', 'lab-b'],
})

/**
 * 模块自检
 * @returns {{ name: string, passed: boolean, checks: Array<{label: string, passed: boolean, detail: string}> }}
 */
export function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  const DAY = new Date(2026, 8, 28, 14, 0, 0).getTime()
  const MIN = 60000
  const series = (ratios) => ratios.map((ratio, i) => ({
    locationId: 'canteen', name: '食堂', placeKind: 'dining',
    count: Math.round(ratio * 396), capacity: 396, effectiveCapacity: 396,
    ratio, trend: null, ts: DAY + i * MIN,
  }))

  // ① 迟滞
  const evaluator = createCrowdRiskEvaluator()
  let last = null
  for (const ratio of [0.6, 0.8, 0.92, 0.92, 0.92]) last = evaluator.evaluate(series([ratio])[0], { now: DAY })
  const inBand = evaluator.evaluate(series([0.85])[0], { now: DAY + 5 * MIN })
  add('① 双阈值迟滞：落入迟滞带内维持原档不降',
    RISK_LEVEL_ORDER[inBand.level] === RISK_LEVEL_ORDER[last.level],
    `0.92 → 0.85（高于高档下降沿 0.80）→ 仍为「${RISK_LEVEL_LABELS[inBand.level]}」`)

  // ② 驻留
  const spikeEval = createCrowdRiskEvaluator()
  const spike = spikeEval.evaluate(series([0.95])[0], { now: DAY })
  add('② 驻留时间：单次瞬时尖峰不足以升高风险档',
    RISK_LEVEL_ORDER[spike.level] < RISK_LEVEL_ORDER[RISK_LEVEL.HIGH] && spike.dwellCount === 1,
    `仅 1 片 0.95（需 3 片）→ 档位「${RISK_LEVEL_LABELS[spike.level]}」`)

  // ③ 冷却
  const coolEval = createCrowdRiskEvaluator()
  const results = [0, 1, 2, 3, 4].map((i) => coolEval.evaluate(series([0.95])[0], { now: DAY + i * MIN }))
  const alertCount = results.filter((r) => r.alert).length
  add('③ 冷却期：同地点同档位不重复推送',
    alertCount < results.length && results.some((r) => r.suppressed),
    `5 次评估仅 ${alertCount} 次告警，${results.length - alertCount} 次被冷却期抑制`)

  // ④ 趋势外推
  const trendEval = createCrowdRiskEvaluator()
  let trendResult = null
  for (const [i, ratio] of [0.4, 0.55, 0.7].entries()) trendResult = trendEval.evaluate(series([ratio])[0], { now: DAY + i * MIN })
  add('④ 趋势外推：未超限但斜率指向超限即提前预警',
    trendResult.level === RISK_LEVEL.WARN && trendResult.alert?.reason === TRIGGER_REASONS.TREND,
    `0.40 → 0.55 → 0.70（关注档 0.75）→ 触发趋势预警`)

  // ⑤ 天气修正
  const clearEval = createCrowdRiskEvaluator()
  const stormEval = createCrowdRiskEvaluator()
  let clearLevel = null
  let stormLevel = null
  for (const i of [0, 1, 2]) {
    clearLevel = clearEval.evaluate(series([0.78])[0], { now: DAY + i * MIN, weather: { kind: 'clear' } })
    stormLevel = stormEval.evaluate(series([0.78])[0], { now: DAY + i * MIN, weather: { kind: 'rainstorm' } })
  }
  add('⑤ ★ 天气修正：同一占用率晴天正常、暴雨告警',
    RISK_LEVEL_ORDER[stormLevel.level] > RISK_LEVEL_ORDER[clearLevel.level],
    `0.78：晴天「${RISK_LEVEL_LABELS[clearLevel.level]}」→ 暴雨「${RISK_LEVEL_LABELS[stormLevel.level]}」`)

  // ⑥ 空间传播
  const propagation = propagateCrowdRisk({
    readings: [{ locationId: 'canteen', name: '食堂', level: RISK_LEVEL.HIGH }, { locationId: 'library', name: '亭兰图书馆', level: RISK_LEVEL.NORMAL }],
    adjacency: CAMPUS_ADJACENCY,
  })
  add('⑥ ★ 空间传播：邻近地点收到衰减预警',
    propagation.propagated.length > 0 && propagation.propagated.every((p) => RISK_LEVEL_ORDER[p.level] < RISK_LEVEL_ORDER[RISK_LEVEL.HIGH]),
    propagation.detail + `；例：${propagation.propagated[0]?.name} → ${RISK_LEVEL_LABELS[propagation.propagated[0]?.level ?? 'normal']}`)

  // ⑦ 分级矩阵：宿舍 vs 体育场
  const dorm = gradeAlert({ id: 'e1', type: 'construction', locationId: 'dormitory' }, { placeKind: 'dormitory', place: PLACE_CAPACITY.dormitory, at: DAY })
  const stadium = gradeAlert({ id: 'e2', type: 'construction', locationId: 'stadium' }, { placeKind: 'sports', place: PLACE_CAPACITY.stadium, at: DAY })
  add('⑦ ★ 场所敏感度：同一事件类型在宿舍与体育场档位不同',
    SEVERITY_ORDER[dorm.level] > SEVERITY_ORDER[stadium.level],
    `施工类：宿舍「${dorm.levelLabel}」（×${dorm.sensitivity.weight}）> 体育场「${stadium.levelLabel}」（×${stadium.sensitivity.weight}）`)

  // ⑧ 夜间升档
  const NIGHT = new Date(2026, 8, 28, 23, 0, 0).getTime()
  const dayNotice = gradeAlert({ id: 'e3', type: 'activity', locationId: 'library' }, { placeKind: 'teaching', at: DAY })
  const nightNotice = gradeAlert({ id: 'e4', type: 'activity', locationId: 'library' }, { placeKind: 'teaching', at: NIGHT })
  add('⑧ 时段权重：同一事件夜间自动升档',
    SEVERITY_ORDER[nightNotice.level] > SEVERITY_ORDER[dayNotice.level],
    `活动类：14:00「${dayNotice.levelLabel}」→ 23:00「${nightNotice.levelLabel}」`)

  // ⑨ 可信度闸门
  const gateLow = applyCredibilityGate({ type: 'safety', ai: { credibility: { score: 0.55 } } })
  const gateHigh = applyCredibilityGate({ type: 'safety', ai: { credibility: { score: 0.9 } } })
  add('⑨ ★ 安全类强制闸门：低可信度落「待核实」不打点',
    gateLow.passed === false && gateLow.state === ALERT_STATE.VERIFYING && gateHigh.passed === true,
    `55% → ${ALERT_STATE_LABELS[gateLow.state]}（阈值 ${gateLow.threshold}）；90% → 已发布`)

  // ⑩ 状态机 + 封路成对
  const grading = gradeAlert({ id: 'e5', type: 'construction', locationId: 'canteen' }, { placeKind: 'dining', place: PLACE_CAPACITY.canteen, at: DAY })
  let alert = createAlert(
    { id: 'e5', type: 'construction', title: '食堂东侧道路维护', locationId: 'canteen', affectedEdgeIds: [resolveLocationEdge('canteen')], ts: new Date(DAY).toISOString() },
    grading, { now: DAY },
  )
  const effects = []
  let error = null
  for (const [state, meta] of [
    [ALERT_STATE.EXTRACTING, {}], [ALERT_STATE.PENDING, {}], [ALERT_STATE.PUBLISHED, {}],
    [ALERT_STATE.DISPATCHED, { dispatch: { role: '后勤', task: '现场核实' } }],
    [ALERT_STATE.RESOLVED, {}], [ALERT_STATE.CLOSED, {}],
  ]) {
    const result = advanceAlert(alert, state, { at: DAY + MIN, ...meta })
    if (result.error) { error = result.error; break }
    alert = result.alert
    effects.push(...result.sideEffects)
  }
  add('⑩ 状态机全链路可推进，且封路 / 解封成对出现',
    error === null && effects.some((t) => t.includes('affectedEdgeIds 生效')) && effects.some((t) => t.includes('affectedEdgeIds 解除')),
    error ?? effects.join(' ｜ '))

  // ⑪ 预案库
  add('⑪ 预案库六个 + 动作原子八个', Object.keys(PLAYBOOKS).length === 6 && Object.keys(ACTION_CODES).length === 8,
    Object.values(PLAYBOOKS).map((p) => p.label).join(' / '))

  // ⑫ 暴雨预案：真实低洼边 + 避雨模式 + 成对撤销
  const storm = instantiatePlaybook(PLAYBOOK_KIND.RAINSTORM, {}, { now: DAY })
  const run = executePlaybook(storm, { at: DAY })
  const undo = executePlaybook(storm, { at: DAY + MIN, undo: true })
  add('⑫ ★ 暴雨预案：真实低洼边封路 + 避雨模式 + 撤销成对',
    run.changes.blockedEdgesAdd.length === LOW_LYING_EDGES.length &&
    run.changes.blockedEdgesAdd.every((id) => id.startsWith('road:')) &&
    run.changes.routeMode === 'rain' &&
    undo.changes.blockedEdgesRemove.length === run.changes.blockedEdgesAdd.length,
    `${run.changes.blockedEdgesAdd.length} 段真实低洼路段；路线模式 ${run.changes.routeMode}；撤销解除 ${undo.changes.blockedEdgesRemove.length} 段`)

  // ⑬ 处置时效
  const stats = summarizeResponseTimes([
    { level: 'high', raisedAt: DAY, sla: { dueAt: DAY + 15 * MIN }, timeline: [{ at: DAY, state: 'reported' }, { at: DAY + 4 * MIN, state: 'dispatched' }, { at: DAY + 20 * MIN, state: 'closed' }] },
  ])
  add('⑬ ★ 处置时效可计算（证明闭环真的闭合了）', stats.avgResponseMinutes === 4 && stats.closureRate === 100,
    stats.summary)

  // ⑭ 影响通行判定保守
  add('⑭ 影响通行判定保守（避免莫名封路）',
    isBlockingEvent({ type: 'construction', title: '道路维护' }) &&
    isBlockingEvent({ type: 'crowd', title: '门口积水无法通行' }) &&
    !isBlockingEvent({ type: 'activity', title: '图书馆讲座' }),
    '施工类 / 含"无法通行" → 封路；活动类 → 不封路')

  // ⑮ 邻接表覆盖主要场所
  add('⑮ 邻接表覆盖主要人流场所', Object.keys(CAMPUS_ADJACENCY).length >= 25,
    `${Object.keys(CAMPUS_ADJACENCY).length} 个地点已标注传导关系`)

  return { name: 'domain/safety/index.js', passed: checks.every((c) => c.passed), checks }
}
