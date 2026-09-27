import { useState } from 'react'
import { ArrowRight, ArrowUpDown, ListOrdered, MapPinned, Route, X } from 'lucide-react'
import {
  getRouteInstructions,
  getRouteModeDescription,
  ROUTE_MODE_LABELS,
  ROUTE_MODES,
} from '../../domain/route.js'

export function getRouteStatusLabel(routePlan) {
  if (routePlan?.status === 'arrived') return '已到达目的地'
  if (routePlan?.unavailableReason === 'origin-closed') return '出发地点暂时关闭'
  if (routePlan?.unavailableReason === 'destination-closed') return '目的地点暂时关闭'
  return routePlan?.status === 'unavailable'
    ? '当前模式下没有可用路线'
    : `约 ${routePlan.durationMinutes} 分钟`
}

export function RouteDock({
  routePlan,
  locations = [],
  showRoute = true,
  onModeChange,
  onOriginChange,
  onDestinationChange,
  onSwap,
  onClear,
}) {
  const [openPanel, setOpenPanel] = useState(null)
  if (!routePlan) return null

  const destinationName = locations.find((location) => location.id === routePlan.destinationId)?.name ?? routePlan.destinationId
  const originName = locations.find((location) => location.id === routePlan.originId)?.name ?? routePlan.originId
  const instructions = getRouteInstructions(routePlan, locations)
  const togglePanel = (panel) => setOpenPanel((current) => current === panel ? null : panel)

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
      <div className="route-dock__utilities">
        <button
          className={openPanel === 'endpoints' ? 'is-active' : ''}
          type="button"
          aria-expanded={openPanel === 'endpoints'}
          onClick={() => togglePanel('endpoints')}
        >
          <MapPinned size={13} /> 起终点
        </button>
        <button
          className={openPanel === 'instructions' ? 'is-active' : ''}
          type="button"
          aria-expanded={openPanel === 'instructions'}
          onClick={() => togglePanel('instructions')}
        >
          <ListOrdered size={13} /> 路线指引{instructions.length ? ` · ${instructions.length} 段` : ''}
        </button>
      </div>
      {openPanel === 'endpoints' && (
        <div className="route-dock__flyout route-dock__flyout--endpoints">
          <strong>调整路线起终点</strong>
          <div className="route-dock__endpoint-grid">
            <label>
              <span>出发地点</span>
              <select value={routePlan.originId} onChange={(event) => onOriginChange?.(event.target.value)}>
                {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label>
              <span>到达地点</span>
              <select value={routePlan.destinationId} onChange={(event) => onDestinationChange?.(event.target.value)}>
                {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}
      {openPanel === 'instructions' && (
        <div className="route-dock__flyout route-dock__flyout--instructions">
          <strong>{routePlan.status === 'unavailable' ? '暂时无法规划这条路线' : '路线分段指引'}</strong>
          <p className="route-dock__reason">{getRouteModeDescription(routePlan)}</p>
          {routePlan.status === 'unavailable' ? (
            <p className="route-dock__empty">请更换起终点或路线模式后重试。</p>
          ) : routePlan.status === 'arrived' ? (
            <p className="route-dock__empty">当前位置已经是目的地。</p>
          ) : instructions.length ? (
            <ol className="route-dock__steps">
              {instructions.map((instruction, index) => (
                <li key={`${instruction.direction}-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{instruction.direction}</strong>
                  <small>约 {instruction.distance} 米</small>
                  {instruction.destinationName && <em>到达 {instruction.destinationName}</em>}
                </li>
              ))}
            </ol>
          ) : <p className="route-dock__empty">该路线暂时没有可展示的分段指引。</p>}
        </div>
      )}
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
