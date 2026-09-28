import { describe, expect, it } from 'vitest'
import {
  CAPACITY_BASIS, COVERED_ROUTE_EDGES, LOCATION_EDGE_MAP, LOW_LYING_EDGES,
  PLACE_CAPACITY, TYPE_TO_PLACE_KIND,
  applyWeatherToThresholds, computeCapacity, computeEffectiveCapacity,
  createCrowdReading, deriveCrowdStatus, getPlaceSensitivity, resolveLocationEdge,
} from './capacity.js'
import {
  ACTION_CODES, ALERT_STATE, CAMPUS_ADJACENCY, PLAYBOOKS, RISK_LEVEL,
  advanceAlert, applyCredibilityGate, createAlert, createCrowdRiskEvaluator,
  executePlaybook, gradeAlert, instantiatePlaybook, isBlockingEvent,
  propagateCrowdRisk, selectPlaybook, summarizeResponseTimes,
} from './index.js'
import { REPO_BUILDINGS } from '../../data/sharedRepoBuildings.js'
import { ROAD_EDGES, roadEdgeId } from '../../data/roadNetwork.js'

const DAY = new Date(2026, 8, 28, 14, 0, 0).getTime()
const MIN = 60 * 1000

const reading = (locationId, ratio, ts = DAY) => createCrowdReading({
  locationId,
  count: Math.round(ratio * computeCapacity(PLACE_CAPACITY[locationId]).capacity),
  ts,
  place: PLACE_CAPACITY[locationId],
  weather: { kind: 'clear' },
})

describe('安全模式 · 容量口径', () => {
  it('覆盖全部 30 个真实建筑，且没有多余配置', () => {
    const realIds = REPO_BUILDINGS.map((building) => building.id).sort()
    const configuredIds = Object.keys(PLACE_CAPACITY).sort()
    expect(configuredIds).toEqual(realIds)
  })

  it('八种建筑 type 全部映射到容量口径', () => {
    const types = [...new Set(REPO_BUILDINGS.map((building) => building.type))]
    for (const type of types) {
      expect(TYPE_TO_PLACE_KIND[type], `type=${type} 未映射`).toBeTruthy()
    }
    expect(Object.keys(CAPACITY_BASIS).length).toBeGreaterThanOrEqual(8)
  })

  it('容量口径按类型分档，且实验室比同规模教学场所更保守', () => {
    expect(computeCapacity(PLACE_CAPACITY.canteen).capacity).toBe(Math.round(330 * 1.2))
    expect(computeCapacity(PLACE_CAPACITY.library).capacity).toBe(800)

    const lab = computeCapacity(PLACE_CAPACITY['lab-a'])
    const sameSizeTeaching = computeCapacity({ kind: 'teaching', evacuationCapacity: 600 })
    expect(lab.capacity).toBeLessThan(sameSizeTeaching.capacity)
  })

  it('通行类按通道宽度折算容量', () => {
    const ring = computeCapacity(PLACE_CAPACITY['ring-s4'])
    expect(ring.capacity).toBe(Math.round(23 * 5 * 4))
  })

  it('★ 天气修正：同一人数在暴雨下占用率更高', () => {
    const clear = createCrowdReading({ locationId: 'canteen', count: 312, ts: DAY, place: PLACE_CAPACITY.canteen, weather: { kind: 'clear' } })
    const storm = createCrowdReading({ locationId: 'canteen', count: 312, ts: DAY, place: PLACE_CAPACITY.canteen, weather: { kind: 'rainstorm' } })
    expect(storm.ratio).toBeGreaterThan(clear.ratio)
    expect(storm.effectiveCapacity).toBeLessThan(clear.effectiveCapacity)
  })

  it('天气通过下调阈值生效，而不是在判定里写分支', () => {
    const base = { warn: { up: 0.75, down: 0.65 }, high: { up: 0.9, down: 0.8 }, critical: { up: 1.05, down: 0.95 } }
    const adjusted = applyWeatherToThresholds(base, { kind: 'rainstorm' })
    expect(adjusted.warn.up).toBeLessThan(base.warn.up)
    expect(adjusted.weatherAdjusted).toBe(true)
    expect(applyWeatherToThresholds(base, { kind: 'clear' }).warn.up).toBe(base.warn.up)
  })

  it('枚举派生视图向后兼容既有 crowdStatus', () => {
    expect(deriveCrowdStatus(0.1)).toBe('low')
    expect(deriveCrowdStatus(0.4)).toBe('normal')
    expect(deriveCrowdStatus(0.7)).toBe('busy')
    expect(deriveCrowdStatus(0.4, { level: 'high' })).toBe('busy')
  })

  it('场所敏感度：宿舍与实验室最高', () => {
    expect(getPlaceSensitivity('dormitory').weight).toBe(1.5)
    expect(getPlaceSensitivity('laboratory').weight).toBe(1.5)
    expect(getPlaceSensitivity('sports').weight).toBe(1.0)
  })
})

describe('安全模式 · 路段 id 与真实路网对齐', () => {
  const realEdgeIds = new Set(ROAD_EDGES.map(([from, to]) => roadEdgeId(from, to)))

  it('★ 低洼路段与避雨通道的边 id 全部存在于真实路网', () => {
    for (const edgeId of [...LOW_LYING_EDGES, ...COVERED_ROUTE_EDGES]) {
      expect(realEdgeIds.has(edgeId), `${edgeId} 不在 ROAD_EDGES 中`).toBe(true)
    }
  })

  it('★ 地点 → 路段映射全部指向真实存在的边', () => {
    for (const [locationId, edgeId] of Object.entries(LOCATION_EDGE_MAP)) {
      expect(PLACE_CAPACITY[locationId], `${locationId} 不是真实建筑`).toBeTruthy()
      expect(realEdgeIds.has(edgeId), `${locationId} → ${edgeId} 不存在`).toBe(true)
    }
  })

  it('未知地点返回 null 而不瞎猜坐标', () => {
    expect(resolveLocationEdge('not-a-real-place')).toBeNull()
  })

  it('边 id 格式统一为 road:节点:节点', () => {
    for (const edgeId of [...LOW_LYING_EDGES, ...COVERED_ROUTE_EDGES]) {
      expect(edgeId).toMatch(/^road:[a-z0-9_]+:[a-z0-9_]+$/)
    }
  })
})

describe('安全模式 · 人流阈值风控', () => {
  it('双阈值迟滞：落入迟滞带内维持原档', () => {
    const evaluator = createCrowdRiskEvaluator()
    let last = null
    for (const [i, ratio] of [0.6, 0.8, 0.92, 0.92, 0.92].entries()) {
      last = evaluator.evaluate(reading('canteen', ratio, DAY + i * MIN), { now: DAY + i * MIN })
    }
    expect(last.level).toBe(RISK_LEVEL.HIGH)

    const inBand = evaluator.evaluate(reading('canteen', 0.85, DAY + 5 * MIN), { now: DAY + 5 * MIN })
    expect(inBand.level).toBe(RISK_LEVEL.HIGH) // 0.85 > 高档下降沿 0.80，不降档
  })

  it('驻留确认：单次瞬时尖峰不足以升高风险档', () => {
    const evaluator = createCrowdRiskEvaluator()
    const spike = evaluator.evaluate(reading('canteen', 0.95), { now: DAY })
    expect(spike.level).not.toBe(RISK_LEVEL.HIGH)
    expect(spike.dwellCount).toBe(1)
  })

  it('冷却期：同地点同档位不重复推送', () => {
    const evaluator = createCrowdRiskEvaluator()
    const results = [0, 1, 2, 3, 4].map((i) => evaluator.evaluate(reading('canteen', 0.95, DAY + i * MIN), { now: DAY + i * MIN }))
    const alerts = results.filter((result) => result.alert)
    expect(alerts.length).toBeLessThan(results.length)
    expect(results.some((result) => result.suppressed)).toBe(true)
  })

  it('趋势外推：未超限但斜率指向超限即提前预警', () => {
    const evaluator = createCrowdRiskEvaluator()
    let last = null
    for (const [i, ratio] of [0.4, 0.55, 0.7].entries()) {
      last = evaluator.evaluate(reading('canteen', ratio, DAY + i * MIN), { now: DAY + i * MIN })
    }
    expect(last.level).toBe(RISK_LEVEL.WARN)
    expect(last.alert?.reason).toBe('trend')
  })

  it('★ 天气修正：同一占用率晴天正常、暴雨告警', () => {
    const run = (weatherKind) => {
      const evaluator = createCrowdRiskEvaluator()
      let last = null
      for (const i of [0, 1, 2]) {
        const r = createCrowdReading({
          locationId: 'canteen', count: Math.round(0.78 * computeCapacity(PLACE_CAPACITY.canteen).capacity),
          ts: DAY + i * MIN, place: PLACE_CAPACITY.canteen, weather: { kind: weatherKind },
        })
        last = evaluator.evaluate(r, { weather: { kind: weatherKind }, now: DAY + i * MIN })
      }
      return last
    }
    expect(run('rainstorm').level).not.toBe(run('clear').level)
  })

  it('★ 空间传导：邻近地点收到衰减预警', () => {
    const result = propagateCrowdRisk({
      readings: [
        { locationId: 'canteen', name: '食堂', level: RISK_LEVEL.HIGH },
        { locationId: 'library', name: '亭兰图书馆', level: RISK_LEVEL.NORMAL },
      ],
      adjacency: CAMPUS_ADJACENCY,
    })
    expect(result.propagated.length).toBeGreaterThan(0)
    for (const item of result.propagated) {
      expect(item.level).not.toBe(RISK_LEVEL.HIGH)
    }
  })

  it('邻接表只引用真实建筑', () => {
    for (const [source, neighbors] of Object.entries(CAMPUS_ADJACENCY)) {
      expect(PLACE_CAPACITY[source], `${source} 不是真实建筑`).toBeTruthy()
      for (const neighbor of neighbors) {
        expect(PLACE_CAPACITY[neighbor], `${neighbor} 不是真实建筑`).toBeTruthy()
      }
    }
  })
})

describe('安全模式 · 预警分级与状态机', () => {
  it('★ 场所敏感度：同一事件在宿舍与体育场档位不同', () => {
    const dorm = gradeAlert({ id: 'a', type: 'construction', locationId: 'dormitory' },
      { placeKind: 'dormitory', place: PLACE_CAPACITY.dormitory, at: DAY })
    const stadium = gradeAlert({ id: 'b', type: 'construction', locationId: 'stadium' },
      { placeKind: 'sports', place: PLACE_CAPACITY.stadium, at: DAY })
    expect(dorm.levelOrder).toBeGreaterThan(stadium.levelOrder)
  })

  it('时段权重：夜间自动升档，且最低档也能升', () => {
    const NIGHT = new Date(2026, 8, 28, 23, 0, 0).getTime()
    const day = gradeAlert({ id: 'c', type: 'activity', locationId: 'library' }, { placeKind: 'teaching', at: DAY })
    const night = gradeAlert({ id: 'd', type: 'activity', locationId: 'library' }, { placeKind: 'teaching', at: NIGHT })
    expect(night.levelOrder).toBeGreaterThan(day.levelOrder)
  })

  it('★ 安全类强制闸门：低可信度落「待核实」', () => {
    const low = applyCredibilityGate({ type: 'safety', ai: { credibility: { score: 0.55 } } })
    const high = applyCredibilityGate({ type: 'safety', ai: { credibility: { score: 0.9 } } })
    expect(low.passed).toBe(false)
    expect(low.state).toBe(ALERT_STATE.VERIFYING)
    expect(low.threshold).toBe(0.75)
    expect(high.passed).toBe(true)
  })

  it('非安全类低可信度走普通待核查，而非待核实', () => {
    const gate = applyCredibilityGate({ type: 'service', ai: { credibility: { score: 0.55 } } })
    expect(gate.state).toBe(ALERT_STATE.PENDING)
    expect(gate.threshold).toBe(0.65)
  })

  it('状态机拒绝非法迁移，且不破坏原状态', () => {
    const grading = gradeAlert({ id: 'e', type: 'construction', locationId: 'canteen' },
      { placeKind: 'dining', place: PLACE_CAPACITY.canteen, at: DAY })
    const alert = createAlert({ id: 'e', type: 'construction', title: '测试', locationId: 'canteen' }, grading, { now: DAY })
    const illegal = advanceAlert(alert, ALERT_STATE.PUBLISHED, { at: DAY })
    expect(illegal.error).toBeTruthy()
    expect(illegal.alert.state).toBe(ALERT_STATE.REPORTED)
  })

  it('★ 封路与解封成对出现', () => {
    const grading = gradeAlert({ id: 'e', type: 'construction', locationId: 'canteen' },
      { placeKind: 'dining', place: PLACE_CAPACITY.canteen, at: DAY })
    let alert = createAlert({
      id: 'e', type: 'construction', title: '食堂东侧道路维护', locationId: 'canteen',
      affectedEdgeIds: [resolveLocationEdge('canteen')], ts: new Date(DAY).toISOString(),
    }, grading, { now: DAY })

    const effects = []
    for (const [state, meta] of [
      [ALERT_STATE.EXTRACTING, {}], [ALERT_STATE.PENDING, {}], [ALERT_STATE.PUBLISHED, {}],
      [ALERT_STATE.DISPATCHED, { dispatch: { role: '后勤', task: '现场核实' } }],
      [ALERT_STATE.RESOLVED, {}], [ALERT_STATE.CLOSED, {}],
    ]) {
      const result = advanceAlert(alert, state, { at: DAY + MIN, ...meta })
      expect(result.error).toBeNull()
      alert = result.alert
      effects.push(...result.sideEffects)
    }
    expect(effects.some((t) => t.includes('affectedEdgeIds 生效'))).toBe(true)
    expect(effects.some((t) => t.includes('affectedEdgeIds 解除'))).toBe(true)
  })

  it('影响通行判定保守：普通报修不触发封路', () => {
    expect(isBlockingEvent({ type: 'construction', title: '道路维护' })).toBe(true)
    expect(isBlockingEvent({ type: 'crowd', title: '门口积水无法通行' })).toBe(true)
    expect(isBlockingEvent({ type: 'activity', title: '图书馆讲座' })).toBe(false)
  })

  it('★ 处置时效可计算', () => {
    const stats = summarizeResponseTimes([{
      level: 'high', raisedAt: DAY, sla: { dueAt: DAY + 15 * MIN },
      timeline: [{ at: DAY, state: 'reported' }, { at: DAY + 4 * MIN, state: 'dispatched' }, { at: DAY + 20 * MIN, state: 'closed' }],
    }])
    expect(stats.avgResponseMinutes).toBe(4)
    expect(stats.closureRate).toBe(100)
  })
})

describe('安全模式 · 处置预案', () => {
  it('预案库六个、动作原子八个', () => {
    expect(Object.keys(PLAYBOOKS)).toHaveLength(6)
    expect(Object.keys(ACTION_CODES)).toHaveLength(8)
  })

  it('动作按确定性顺序执行：先隔离风险，后通知', () => {
    const storm = instantiatePlaybook('rainstorm', {}, { now: DAY })
    const orders = storm.steps.map((step) => step.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(storm.steps[0].action).toBe(ACTION_CODES.BLOCK_EDGE)
  })

  it('★ 暴雨预案：真实低洼边封路 + 避雨模式', () => {
    const storm = instantiatePlaybook('rainstorm', {}, { now: DAY })
    const run = executePlaybook(storm, { at: DAY })
    expect(run.changes.blockedEdgesAdd).toHaveLength(LOW_LYING_EDGES.length)
    expect(run.changes.routeMode).toBe('rain')
    expect(run.changes.outdoorPaused).toBe(true)
  })

  it('★ 撤销与执行成对（封路与解封是同一套机制的两个方向）', () => {
    const storm = instantiatePlaybook('rainstorm', {}, { now: DAY })
    const run = executePlaybook(storm, { at: DAY })
    const undo = executePlaybook(storm, { at: DAY + MIN, undo: true })
    expect(undo.changes.blockedEdgesRemove).toHaveLength(run.changes.blockedEdgesAdd.length)
    expect(undo.changes.blockedEdgesAdd).toHaveLength(0)
  })

  it('缺变量时跳过该步骤，不静默产出坏数据', () => {
    const partial = instantiatePlaybook('road-blocked', {}, { now: DAY })
    const run = executePlaybook(partial, { at: DAY })
    expect(partial.unresolved.length).toBeGreaterThan(0)
    expect(run.skipped.length).toBeGreaterThan(0)
    expect(run.changes.blockedEdgesAdd).not.toContain(undefined)
  })

  it('六种态势可自动选中对应预案，风险未达阈值则不启动', () => {
    expect(selectPlaybook({ weatherKind: 'rainstorm' }).kind).toBe('rainstorm')
    expect(selectPlaybook({ weatherKind: 'hail' }).kind).toBe('hail')
    expect(selectPlaybook({ weatherKind: 'heat' }).kind).toBe('heat')
    expect(selectPlaybook({ blocking: true }).kind).toBe('road-blocked')
    expect(selectPlaybook({ crowdRiskLevel: 'high' }).kind).toBe('crowd-overflow')
    expect(selectPlaybook({ bigEvent: true }).kind).toBe('big-event')
    expect(selectPlaybook({ crowdRiskLevel: 'normal' }).kind).toBeNull()
  })
})
