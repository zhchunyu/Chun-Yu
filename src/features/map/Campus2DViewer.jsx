import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, LocateFixed, MapPinned, Minus, Plus, RefreshCw } from 'lucide-react'
import { majorMapLabels } from '../../data/mapLabels.js'
import { getLocationMapPosition, getRouteMapPoints } from '../../domain/mapScene.js'
import { panMapViewport, zoomMapViewport } from '../../domain/mapViewport.js'

function markerStyle(position) {
  return {
    left: `${position[0] * 100}%`,
    top: `${position[1] * 100}%`,
  }
}

function routePointsToSvg(points) {
  return points?.map(([x, y]) => `${x * 100},${y * 100}`).join(' ') ?? ''
}

export function Campus2DViewer({
  mapUrl,
  locations = [],
  visibleLocationIds = new Set(),
  events = [],
  selectedId = null,
  currentLocationId = null,
  routePlan = null,
  showLabels = true,
  showStatusColors = true,
  showTips = true,
  resetViewToken = 0,
  onSelectLocation,
}) {
  const viewerRef = useRef(null)
  const dragRef = useRef(null)
  const [imageState, setImageState] = useState('loading')
  const [imageKey, setImageKey] = useState(0)
  const [viewport, setViewport] = useState({ scale: 1, offsetX: 0, offsetY: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const routePoints = useMemo(() => getRouteMapPoints(routePlan, '2d'), [routePlan])
  const currentLocation = locations.find((location) => location.id === currentLocationId) ?? null
  const hotspotLocationIds = useMemo(() => new Set(events.map((event) => event.locationId)), [events])

  const retryImage = () => {
    setImageState('loading')
    setImageKey((key) => key + 1)
  }

  const resetViewport = () => setViewport({ scale: 1, offsetX: 0, offsetY: 0 })

  useEffect(() => {
    resetViewport()
  }, [resetViewToken])

  const zoomFromCenter = (direction) => {
    setViewport((current) => zoomMapViewport(current, direction))
  }

  const handleWheel = (event) => {
    event.preventDefault()
    const rect = viewerRef.current?.getBoundingClientRect()
    if (!rect) return

    setViewport((current) => zoomMapViewport(current, event.deltaY < 0 ? 1 : -1, {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    }))
  }

  const handleDoubleClick = (event) => {
    const rect = viewerRef.current?.getBoundingClientRect()
    if (!rect) return
    setViewport((current) => zoomMapViewport(current, 1, {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    }))
  }

  const handlePointerDown = (event) => {
    if (event.target.closest('button')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewport,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setViewport(panMapViewport(drag.viewport, event.clientX - drag.startX, event.clientY - drag.startY))
  }

  const handlePointerUp = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    setIsDragging(false)
  }

  return (
    <div
      className={`campus-2d-viewer ${isDragging ? 'is-dragging' : ''}`}
      ref={viewerRef}
      onWheel={handleWheel}
    >
      <div
        className="campus-2d-stage"
        style={{ transform: `translate3d(${viewport.offsetX}px, ${viewport.offsetY}px, 0) scale(${viewport.scale})` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          key={imageKey}
          className={`campus-2d-image campus-2d-image--${imageState}`}
          src={mapUrl}
          alt="山河大学校园总平面格局图"
          onLoad={() => setImageState('ready')}
          onError={() => setImageState('error')}
        />

        {imageState === 'ready' && (
          <div className="campus-2d-overlay">
            {routePoints && (
              <svg className="campus-2d-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="当前路线">
                <polyline points={routePointsToSvg(routePoints)} />
                <circle cx={routePoints[0][0] * 100} cy={routePoints[0][1] * 100} r="1.5" className="campus-2d-route__origin" />
                <circle cx={routePoints.at(-1)[0] * 100} cy={routePoints.at(-1)[1] * 100} r="1.8" className="campus-2d-route__destination" />
              </svg>
            )}

            {showLabels && (
              <div className="campus-2d-landmark-labels" aria-label="校园主要区域标签">
                {majorMapLabels.map((label) => (
                  <span className="campus-2d-landmark-label" key={label.id} style={markerStyle(label.position)}>
                    <span className="campus-2d-landmark-label__line" />
                    <span className="campus-2d-landmark-label__text">{label.name}</span>
                  </span>
                ))}
              </div>
            )}

            {locations.filter((location) => visibleLocationIds.has(location.id)).map((location) => {
              const position = getLocationMapPosition(location, '2d')
              if (!position) return null
              const isSelected = selectedId === location.id
              const isCurrent = currentLocationId === location.id
              return (
                <button
                  className={`campus-2d-marker ${isSelected ? 'is-selected' : ''} ${isCurrent ? 'is-current' : ''} ${showStatusColors && location.crowdStatus === 'busy' ? 'is-busy' : ''} ${hotspotLocationIds.has(location.id) ? 'has-hotspot' : ''}`}
                  key={location.id}
                  type="button"
                  style={markerStyle(position)}
                  aria-label={`查看${location.name}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelectLocation(location.id)}
                >
                  <span className="campus-2d-marker__dot" />
                  <span className="campus-2d-marker__label">{location.name}</span>
                </button>
              )
            })}

            {currentLocation && !visibleLocationIds.has(currentLocation.id) && (
              <div className="campus-2d-current-note"><LocateFixed size={14} />当前位置已被筛选隐藏</div>
            )}
          </div>
        )}

        {imageState === 'loading' && (
          <div className="campus-2d-state"><MapPinned size={18} /><span>2D 平面图加载中…</span></div>
        )}
        {imageState === 'error' && (
          <div className="campus-2d-state campus-2d-state--error">
            <CircleAlert size={18} />
            <span>2D 底图加载失败</span>
            <button type="button" onClick={retryImage}><RefreshCw size={13} />重试</button>
          </div>
        )}
        {routePlan?.status === 'preview' && !routePoints && (
          <div className="campus-2d-route-note">该场景暂未完成路线校准</div>
        )}
        {routePlan?.status === 'arrived' && (
          <div className="campus-2d-route-note">当前位置已在目的地，无需规划路线</div>
        )}
        {routePlan?.status === 'unavailable' && (
          <div className="campus-2d-route-note">当前路线模式下没有可用路线</div>
        )}
      </div>
      <div className="campus-2d-controls" aria-label="2D 地图操作">
        <button type="button" aria-label="放大地图" title="放大" onClick={() => zoomFromCenter(1)}><Plus size={15} /></button>
        <span aria-live="polite">{Math.round(viewport.scale * 100)}%</span>
        <button type="button" aria-label="缩小地图" title="缩小" onClick={() => zoomFromCenter(-1)}><Minus size={15} /></button>
        <button type="button" aria-label="重置地图视图" title="重置视图" onClick={resetViewport}><RefreshCw size={14} /></button>
      </div>
      {showTips && <div className="campus-2d-help">滚轮缩放 · 按住地图拖动 · 双击放大</div>}
    </div>
  )
}
