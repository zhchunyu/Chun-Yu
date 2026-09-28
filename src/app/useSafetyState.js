import { useCallback, useMemo, useState } from 'react'
import {
  PLACE_CAPACITY, computeEffectiveCapacity, createCrowdReading, resolveLocationEdge,
} from '../domain/safety/capacity.js'
import {
  ALERT_STATE, CAMPUS_ADJACENCY, RISK_LEVEL,
  advanceAlert, applyCredibilityGate, createAlert, createCrowdRiskEvaluator, executePlaybook,
  gradeAlert, instantiatePlaybook, isBlockingEvent, propagateCrowdRisk, selectPlaybook,
  summarizeResponseTimes, summarizeRiskLevels,
} from '../domain/safety/index.js'
import { WEATHER_SCENARIOS, DEMO_REPORTS } from '../data/safetyDemo.js'

/** `crowdStatus` 枚举 → 基准占用率，使面板与既有数据同源 */
const STATUS_TO_RATIO = { low: 0.22, normal: 0.46, busy: 0.78 }

/**
 * ★ 预警状态机必须**逐跳**推进
 * ---------------------------------------------------------------------------
 * `createAlert()` 的起点是「已上报」，而 `ALERT_TRANSITIONS` 只允许
 * `reported → extracting → pending → published / verifying`。
 * `advanceAlert()` 遇到非法跳转时**不抛错**，而是返回 `{ error }`：
 * 之前这里直接 `advanceAlert(alert, PUBLISHED)`，于是所有预警都静默停在「已上报」，
 * 连带「可信度闸门（灰标不打点 / 确认可信）」与「处置预案（一键启动预案）」
 * 两段演示都没有入口 —— 面板永远显示「当前态势不需要启动预案」。
 */
const ALERT_CHAIN = Object.freeze({
  [ALERT_STATE.PENDING]: Object.freeze([ALERT_STATE.EXTRACTING, ALERT_STATE.PENDING]),
  [ALERT_STATE.VERIFYING]: Object.freeze([ALERT_STATE.EXTRACTING, ALERT_STATE.PENDING, ALERT_STATE.VERIFYING]),
  [ALERT_STATE.PUBLISHED]: Object.freeze([ALERT_STATE.EXTRACTING, ALERT_STATE.PENDING, ALERT_STATE.PUBLISHED]),
})

function advanceAlertChain(alert, target, meta = {}) {
  const steps = ALERT_CHAIN[target]
  if (!steps) return { alert, sideEffects: [], error: `未定义的推进路径：${target}` }

  let current = alert
  const sideEffects = []
  for (const [index, state] of steps.entries()) {
    const isLast = index === steps.length - 1
    const result = advanceAlert(current, state, isLast ? meta : { at: meta.at, actor: meta.actor })
    if (result.error) return { alert: current, sideEffects, error: result.error }
    current = result.alert
    sideEffects.push(...result.sideEffects)
  }
  return { alert: current, sideEffects, error: null }
}

/**
 * 安全态势 Hook
 * ---------------------------------------------------------------------------
 * ★ 为什么要把计算从面板里抽出来：
 *   地图叠加层（`SafetyMapOverlay`）与面板（`SafetyModePanel`）需要**同一份态势**。
 *   如果两边各算一次，就会出现「面板说高风险、地图没画红圈」的不一致 ——
 *   演示时最容易被一眼看穿。抽成 hook 后由 `MapWorkspace` 持有，两处共享。
 *
 * 数据来源全部是**既有真实数据**：
 *   · 地点与 `crowdStatus`  → `locationRepository`
 *   · 事件与 `affectedEdgeIds` → `eventRepository`
 *   · 路段几何 → `roadNetwork.js`
 * 仅 `DEMO_REPORTS` 是为演示可信度闸门而构造的，已在 UI 上标注「演示数据」。
 */
export function useSafetyState({ locations = [], events = [], now = Date.now() }) {
  const [weatherId, setWeatherId] = useState('clear')
  const [executedActions, setExecutedActions] = useState([])
  const [appliedRun, setAppliedRun] = useState(null)
  const [overrideEvents, setOverrideEvents] = useState(null)

  const weather = WEATHER_SCENARIOS.find((item) => item.id === weatherId) ?? WEATHER_SCENARIOS[0]

  // ---- ① 人流风控：由 crowdStatus 派生占用率，跑迟滞 / 驻留 / 冷却 / 趋势 ----
  const crowd = useMemo(() => {
    const evaluator = createCrowdRiskEvaluator()
    const results = []

    for (const location of locations) {
      const config = PLACE_CAPACITY[location.id]
      if (!config) continue

      const baseRatio = STATUS_TO_RATIO[location.crowdStatus] ?? 0.46
      const ratios = [baseRatio * 0.82, baseRatio * 0.9, baseRatio * 0.96, baseRatio]
      let reading = null
      let evaluation = null

      ratios.forEach((ratio, index) => {
        const capacityInfo = computeEffectiveCapacity(config, weather)
        reading = createCrowdReading({
          locationId: location.id,
          count: Math.round(ratio * capacityInfo.baseCapacity),
          ts: now - (ratios.length - 1 - index) * 60000,
          place: config,
          weather,
        })
        evaluation = evaluator.evaluate(reading, { weather, now: reading.ts })
      })

      results.push({ location, config, reading, evaluation })
    }

    const active = results.map((item) => ({
      locationId: item.location.id,
      name: item.location.name,
      level: item.evaluation?.level ?? RISK_LEVEL.NORMAL,
    }))

    return {
      results,
      overview: summarizeRiskLevels(active),
      propagation: propagateCrowdRisk({ readings: active, adjacency: CAMPUS_ADJACENCY }),
    }
  }, [locations, weather, now])

  // ---- ② 预警：既有事件 + 演示上报，经分级矩阵与可信度闸门 ----
  const baseEvents = useMemo(() => [
    ...events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      locationId: event.locationId,
      impact: event.impact,
      affectedEdgeIds: event.affectedEdgeIds ?? [],
      ts: event.startAt,
    })),
    ...DEMO_REPORTS,
  ], [events])

  const alerts = useMemo(() => (overrideEvents ?? baseEvents).map((event) => {
    const place = PLACE_CAPACITY[event.locationId] ?? null
    const at = event.ts ? new Date(event.ts).getTime() : now
    const grading = gradeAlert(event, { place, placeKind: place?.kind ?? 'plaza', at })
    const alert = createAlert(event, grading, { now })
    const gate = applyCredibilityGate(event)

    alert.grading = grading
    alert.gate = gate
    alert.credibility = event.ai?.credibility ?? null

    // ★ 逐跳推进到闸门判定的目标状态（通过 → 已发布；未通过 → 待核查 / 待核实）
    const advanced = advanceAlertChain(alert, gate.passed ? ALERT_STATE.PUBLISHED : gate.state, {
      at: alert.raisedAt, actor: 'AI 核查', detail: gate.detail,
    })
    if (advanced.error) {
      alert.timeline.push({ at: alert.raisedAt, state: alert.state, label: '状态机拒绝推进', detail: advanced.error, actor: '系统' })
    } else {
      Object.assign(alert, advanced.alert)
      alert.sideEffects = advanced.sideEffects
    }

    // ★ 待核实的安全类不打点 —— 与既有 shouldHideMarker 语义保持一致
    alert.showMarker = alert.state !== ALERT_STATE.VERIFYING
    return alert
  }).sort((a, b) => b.raisedAt - a.raisedAt), [overrideEvents, baseEvents, now])

  const stats = useMemo(
    () => summarizeResponseTimes(alerts.filter((alert) => alert.state === ALERT_STATE.CLOSED)),
    [alerts],
  )

  // ---- ③ 预案推荐与实例化 ----
  const recommendation = useMemo(() => {
    const top = alerts.find((alert) => alert.state === ALERT_STATE.PUBLISHED)
    if (!top) return { kind: null, reason: '当前没有已发布的预警，无需启动预案', target: null }

    const crowdRisk = crowd.results.find((item) => item.location.id === top.locationId)
    const picked = selectPlaybook({
      weatherKind: weather.kind !== 'clear' ? weather.kind : null,
      crowdRiskLevel: crowdRisk?.evaluation?.level ?? null,
      blocking: isBlockingEvent(top),
      bigEvent: top.type === 'activity',
    })
    return { ...picked, target: top }
  }, [alerts, crowd.results, weather])

  const playbook = useMemo(() => {
    if (!recommendation.kind) return null
    const place = PLACE_CAPACITY[recommendation.target?.locationId] ?? null
    const edgeId = resolveLocationEdge(recommendation.target?.locationId)
    const instance = instantiatePlaybook(recommendation.kind, {
      edgeId,
      edgeLabel: place?.name ? `${place.name}附近路段` : '事发路段',
      placeName: place?.name ?? '',
    }, { level: recommendation.target?.level, now })

    // 已执行过：把步骤状态同步到最新实例，保证 UI 显示 done
    if (appliedRun && appliedRun.kind === instance?.kind) {
      instance.steps.forEach((step) => {
        if (executedActions.includes(step.id)) step.status = 'done'
      })
    }
    return instance
  }, [recommendation, appliedRun, executedActions, now])

  // ---- ④ 已生效的变更（封路 / 关场所 / 路线模式）----
  const blockedEdges = useMemo(() => {
    // ★ 与既有 `getActiveBlockedEdgeIds(events)` 同源：事件自带的封路 + 预案写入的封路
    const fromEvents = events.flatMap((event) => event.affectedEdgeIds ?? [])
    const fromPlaybook = appliedRun?.changes?.blockedEdgesAdd ?? []
    return [...new Set([...fromEvents, ...fromPlaybook])]
  }, [events, appliedRun])

  const highlightEdges = useMemo(() => appliedRun?.changes?.shelters ?? [], [appliedRun])
  const closedPlaces = useMemo(() => appliedRun?.changes?.closedPlaces ?? [], [appliedRun])
  const outdoorPaused = Boolean(appliedRun?.changes?.outdoorPaused)

  // ---- 动作 ----
  const runPlaybook = useCallback((only = null) => {
    if (!playbook) return null
    const run = executePlaybook(playbook, { at: now, only })
    setAppliedRun({ kind: playbook.kind, changes: run.changes, at: now })
    setExecutedActions(playbook.steps.filter((step) => step.status === 'done').map((step) => step.id))
    return run
  }, [playbook, now])

  const undoPlaybook = useCallback(() => {
    if (!playbook) return null
    const run = executePlaybook(playbook, { at: now, undo: true })
    setAppliedRun(null)
    setExecutedActions([])
    return run
  }, [playbook, now])

  /** 人工确认一条「待核实」上报 —— 模拟审核通过 */
  const confirmAlert = useCallback((alert) => {
    setOverrideEvents((previous) => (previous ?? baseEvents).map((event) => (
      event.id === alert.eventId
        ? {
            ...event,
            ai: {
              credibility: {
                ...(event.ai?.credibility ?? {}),
                score: 0.9,
                threshold: alert.gate?.threshold ?? 0.75,
                passed: true,
              },
            },
          }
        : event
    )))
  }, [baseEvents])

  return {
    weather, weatherId, setWeatherId, weatherScenarios: WEATHER_SCENARIOS,
    crowd, alerts, stats, recommendation, playbook,
    executedActions, appliedRun,
    blockedEdges, highlightEdges, closedPlaces, outdoorPaused,
    runPlaybook, undoPlaybook, confirmAlert,
  }
}
