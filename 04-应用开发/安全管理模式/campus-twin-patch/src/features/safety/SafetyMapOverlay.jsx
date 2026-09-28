import { useMemo } from 'react'
import { ROAD_NODES, ROAD_EDGES, roadEdgeId, worldToMapPosition } from '../../data/roadNetwork.js'
import { RISK_LEVEL_COLORS, RISK_LEVEL_LABELS, RISK_LEVEL_ORDER, RISK_LEVEL } from '../../domain/safety/index.js'

/**
 * 安全模式地图叠加层
 * ---------------------------------------------------------------------------
 * ★ 为什么用 SVG + 百分比坐标：
 *   既有 `Campus2DViewer` 用 `<img>` 作底图，其上叠一个
 *   `.campus-2d-overlay`（DOM 标记）与 `<svg viewBox="0 0 100 100">`（路线）。
 *   本组件沿用同一套坐标约定（`worldToMapPosition` → 0–1 归一化百分比），
 *   因此天然与既有路线渲染对齐 —— **不需要 DOM 标记那种上百个按钮**，
 *   SVG 一条 line 就是一段路，几十条也不会卡。
 *
 * ⚠️ 已知限制：叠加层挂在 `.map-surface` 上，**不随 2D 底图的缩放/平移同步**
 *   （底图的 transform 是 `Campus2DViewer` 的内部 state）。
 *   默认视图下完全对齐；若需要同步缩放，需把本组件移进
 *   `Campus2DViewer` 的 `.campus-2d-stage` 内 —— 属于后续优化项，已在文档标注。
 */

/** 场所类型 → 风险半径（占地图宽度的百分比） */
const KIND_RADIUS = {
  dining: 3.2,
  teaching: 3.6,
  dormitory: 3.6,
  laboratory: 3.4,
  sports: 4.6,
  plaza: 4.2,
  gate: 2.8,
  road: 2.4,
}

/** 所有路段的归一化端点坐标（模块级算一次，避免每次渲染重算） */
const EDGE_GEOMETRY = Object.freeze(Object.fromEntries(
  ROAD_EDGES.map(([from, to]) => {
    const a = ROAD_NODES[from]
    const b = ROAD_NODES[to]
    if (!a || !b) return [roadEdgeId(from, to), null]
    // worldToMapPosition 接收 [x, y, z]（three.js 约定，z = -北）
    const [ax, ay] = worldToMapPosition([a.x, 0, -a.y])
    const [bx, by] = worldToMapPosition([b.x, 0, -b.y])
    return [roadEdgeId(from, to), { x1: ax * 100, y1: ay * 100, x2: bx * 100, y2: by * 100 }]
  }).filter(([, value]) => value),
))

export { EDGE_GEOMETRY }

/**
 * 安全态势叠加层
 *
 * @param {object} props
 * @param {Array<{ location: object, reading: object, evaluation: object }>} props.riskResults 各地点的风控结果
 * @param {Array<{ locationId: string, level: string, detail: string }>} [props.propagated] 空间传导预警
 * @param {string[]} [props.blockedEdges] 当前封控的路段 id
 * @param {string[]} [props.highlightEdges] 需高亮的推荐通道（如环廊避雨通道）
 * @param {boolean} [props.showRiskZones] 是否显示风险区
 * @param {boolean} [props.showCrowdHeat] 是否显示人流热力
 * @param {boolean} [props.showBlockedRoads] 是否显示封控路段
 */
export function SafetyMapOverlay({
  riskResults = [],
  propagated = [],
  blockedEdges = [],
  highlightEdges = [],
  showRiskZones = true,
  showCrowdHeat = true,
  showBlockedRoads = true,
}) {
  const zones = useMemo(() => riskResults
    .filter((item) => item.location?.mapPosition?.['2d'])
    .map((item) => {
      const level = item.evaluation?.level ?? RISK_LEVEL.NORMAL
      const [x, y] = item.location.mapPosition['2d']
      return {
        id: item.location.id,
        name: item.location.name,
        level,
        ratio: item.reading?.ratio ?? 0,
        count: item.reading?.count ?? 0,
        capacity: item.reading?.effectiveCapacity ?? 0,
        x: x * 100,
        y: y * 100,
        r: KIND_RADIUS[item.location.placeKind ?? 'plaza'] ?? 3.4,
      }
    }), [riskResults])

  const propagatedZones = useMemo(() => propagated
    .map((item) => {
      const target = riskResults.find((result) => result.location?.id === item.locationId)
      if (!target?.location?.mapPosition?.['2d']) return null
      const [x, y] = target.location.mapPosition['2d']
      return { ...item, name: target.location.name, x: x * 100, y: y * 100 }
    })
    .filter(Boolean), [propagated, riskResults])

  const visibleBlocked = showBlockedRoads
    ? blockedEdges.map((id) => ({ id, geometry: EDGE_GEOMETRY[id] })).filter((item) => item.geometry)
    : []
  const visibleHighlight = showBlockedRoads
    ? highlightEdges.map((id) => ({ id, geometry: EDGE_GEOMETRY[id] })).filter((item) => item.geometry)
    : []

  const hasAnything = zones.length || visibleBlocked.length || visibleHighlight.length

  return (
    <div className="safety-overlay" aria-hidden="true">
      {/*
        ★ 分层原因：路段用 SVG 画（线可以被拉伸，无妨），
          但**风险区与人流热力必须用 HTML 圆形** —— 地图容器的宽高比是 680:595，
          若用 `preserveAspectRatio="none"` 的 SVG 画圆，圆会被拉成椭圆
          （第一版就踩了这个坑，截图里能看到压扁的椭圆）。
          HTML 元素的 `border-radius: 50%` 在任何宽高比下都是正圆。
      */}
      <svg className="safety-overlay__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* 封控路段：粗描边 + 虚线，表示不可通行 */}
        {visibleBlocked.map((item) => (
          <line
            key={`blocked-${item.id}`}
            x1={item.geometry.x1} y1={item.geometry.y1}
            x2={item.geometry.x2} y2={item.geometry.y2}
            className="safety-overlay__blocked"
          />
        ))}

        {/* 推荐 / 避雨通道：亮色高亮 */}
        {visibleHighlight.map((item) => (
          <line
            key={`highlight-${item.id}`}
            x1={item.geometry.x1} y1={item.geometry.y1}
            x2={item.geometry.x2} y2={item.geometry.y2}
            className="safety-overlay__highlight"
          />
        ))}
      </svg>

      {/* 风险区 + 人流热力：HTML 圆形，恒定正圆 */}
      <div className="safety-overlay__zones">
        {showCrowdHeat && zones.map((zone) => (
          <span
            key={`heat-${zone.id}`}
            className="safety-overlay__heat"
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              '--heat-size': `${(1.1 + zone.ratio * 2.4) * 2}%`,
              '--heat-color': RISK_LEVEL_COLORS[zone.level],
              opacity: 0.1 + Math.min(zone.ratio, 1.4) * 0.16,
            }}
          />
        ))}

        {showRiskZones && zones.filter((zone) => zone.level !== RISK_LEVEL.NORMAL).map((zone) => (
          <span
            key={`zone-${zone.id}`}
            className={`safety-overlay__zone is-${zone.level}`}
            style={{
              left: `${zone.x}%`,
              top: `${zone.y}%`,
              '--zone-size': `${zone.r * 2}%`,
              '--zone-color': RISK_LEVEL_COLORS[zone.level],
              '--zone-fill': 0.14 + (RISK_LEVEL_ORDER[zone.level] / RISK_LEVEL_ORDER.critical) * 0.14,
            }}
          />
        ))}

        {/* 空间传导：虚线圆环，表示"被邻近地点带动" */}
        {showRiskZones && propagatedZones.map((zone) => (
          <span
            key={`prop-${zone.locationId}`}
            className="safety-overlay__propagated"
            style={{ left: `${zone.x}%`, top: `${zone.y}%`, '--prop-color': RISK_LEVEL_COLORS.warn }}
          />
        ))}
      </div>

      {/* 标签层：只给达到告警档位的地点打标签，避免遮挡 */}
      {showRiskZones && (
        <div className="safety-overlay__labels">
          {zones.filter((zone) => zone.level !== RISK_LEVEL.NORMAL).map((zone) => (
            <span
              key={`label-${zone.id}`}
              className={`safety-overlay__label is-${zone.level}`}
              style={{ left: `${zone.x}%`, top: `${zone.y}%`, '--label-color': RISK_LEVEL_COLORS[zone.level] }}
            >
              <strong>{zone.name}</strong>
              <small>{RISK_LEVEL_LABELS[zone.level]} · {Math.round(zone.ratio * 100)}%（{zone.count}/{zone.capacity} 人）</small>
            </span>
          ))}
        </div>
      )}

      {!hasAnything && (
        <div className="safety-overlay__empty">当前无风险区与封控路段</div>
      )}
    </div>
  )
}
