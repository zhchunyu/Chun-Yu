import { ArrowRight, ArrowUpDown, Route, X } from 'lucide-react'
import { ROUTE_MODE_LABELS, ROUTE_MODES } from '../../domain/route.js'

export function getRouteStatusLabel(routePlan) {
  if (routePlan?.status === 'arrived') return '已到达目的地'
  return routePlan?.status === 'unavailable'
    ? '当前模式下没有可用路线'
    : `约 ${routePlan.durationMinutes} 分钟`
}

export function RouteDock({ routePlan, locations = [], showRoute = true, onModeChange, onSwap, onClear }) {
  if (!routePlan) return null

  const destinationName = locations.find((location) => location.id === routePlan.destinationId)?.name ?? routePlan.destinationId
  const originName = locations.find((location) => location.id === routePlan.originId)?.name ?? routePlan.originId

  return (
    <section className="route-dock" aria-label="路线预览">
      <div className="route-dock__icon"><Route size={18} /></div>
      <div className="route-dock__summary">
        <span>路线预览 · {routePlan.distance} 米</span>
        <strong>{originName} <ArrowRight size={14} /> {destinationName}</strong>
      </div>
      <button className="route-dock__swap" type="button" onClick={onSwap} aria-label="交换起点和终点" title="交换起点和终点"><ArrowUpDown size={15} /></button>
      <div className="route-dock__modes" aria-label="路线模式">
        {Object.values(ROUTE_MODES).map((mode) => (
          <button className={routePlan.mode === mode ? 'is-active' : ''} type="button" key={mode} onClick={() => onModeChange(mode)}>
            {ROUTE_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      {!showRoute ? (
        <span className="route-dock__unavailable">路线图层已关闭</span>
      ) : routePlan.status === 'unavailable' ? (
        <span className="route-dock__unavailable">{getRouteStatusLabel(routePlan)}</span>
      ) : routePlan.status === 'arrived' ? (
        <span className="route-dock__arrived">{getRouteStatusLabel(routePlan)}</span>
      ) : (
        <span className="route-dock__duration">{getRouteStatusLabel(routePlan)}{routePlan.blockedEdgeIds?.length ? ' · 已纳入实时施工' : ''}</span>
      )}
      <button className="route-dock__clear" type="button" onClick={onClear} aria-label="清除路线"><X size={16} /></button>
    </section>
  )
}
