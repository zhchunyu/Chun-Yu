import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Minus, Navigation, Plus, RotateCcw } from 'lucide-react'
import {
  getTencentCampusPosition,
  TENCENT_CAMPUS_CENTER,
  TENCENT_CAMPUS_MIN_ZOOM,
  TENCENT_CAMPUS_MAX_ZOOM,
  TENCENT_CAMPUS_ZOOM,
} from '../../data/tencentCampusGeo.js'
import { loadTencentMapSdk, requestTencentWalkingRoute } from '../../data/tencentMapApi.js'
import { markStartupReady } from '../../app/startup.js'
import { COMPETITION_PRESENTATION, campusDisplayText, canShowCampusLink } from '../../data/campusPresentation.js'

const apiKey = import.meta.env.VITE_TENCENT_MAP_KEY
const liveLocationMarkerImage = '/assets/current-location.svg'

function normalizePoiName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/山西农业大学|山西农大|太谷校区|校园/g, '')
    .replace(/家属区/g, '家属院')
    .replace(/[\s·()（）_-]/g, '')
    .toLowerCase()
}

function findCampusLocationId(poiName, locations) {
  const poiNameText = String(poiName ?? '').trim()
  if (!poiNameText) return null

  const apartmentNumber = poiNameText.match(/(\d{1,2})(?:号)?(?:公寓)?(?:楼|栋)/)?.[1]
  if (apartmentNumber) {
    const apartment = locations.find((location) => location.mapApartmentNumber === Number(apartmentNumber))
    if (apartment) return apartment.id
  }

  const normalizedPoiName = normalizePoiName(poiNameText)
  const candidates = locations.flatMap((location) => [
    { id: location.id, name: location.name },
    ...(location.aliases ?? []).map((name) => ({ id: location.id, name })),
  ])
  const exactMatch = candidates.find(({ name }) => normalizePoiName(name) === normalizedPoiName)
  if (exactMatch) return exactMatch.id

  const partialMatch = candidates.find(({ name }) => {
    const candidateName = normalizePoiName(name)
    return candidateName.length >= 2 && normalizedPoiName.includes(candidateName)
  })
  return partialMatch?.id ?? null
}

function isInsideCampusBounds(poiPosition, locations) {
  const lat = Number(typeof poiPosition?.getLat === 'function' ? poiPosition.getLat() : poiPosition?.lat)
  const lng = Number(typeof poiPosition?.getLng === 'function' ? poiPosition.getLng() : poiPosition?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false

  const positions = locations
    .map(getTencentCampusPosition)
    .filter(Boolean)
  if (positions.length === 0) return false

  const minLat = Math.min(...positions.map((position) => position.lat)) - 0.0003
  const maxLat = Math.max(...positions.map((position) => position.lat)) + 0.0003
  const minLng = Math.min(...positions.map((position) => position.lng)) - 0.0003
  const maxLng = Math.max(...positions.map((position) => position.lng)) + 0.0003
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
}

function escapeHtml(value) {
  return String(campusDisplayText(value) ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

const campusCategoryLabels = {
  learning: '教学学习',
  dining: '餐饮生活',
  living: '住宿空间',
  service: '校园服务',
  transport: '出行节点',
}

function getCampusPoiCategory(name, location) {
  if (location?.category && campusCategoryLabels[location.category]) return campusCategoryLabels[location.category]

  const poiName = String(name ?? '')
  if (/公寓|宿舍|住宿|家属/.test(poiName)) return campusCategoryLabels.living
  if (/餐厅|食堂|餐饮|美食/.test(poiName)) return campusCategoryLabels.dining
  if (/图书|教学|学院|实验|科研|教室/.test(poiName)) return campusCategoryLabels.learning
  if (/校门|出入口|站/.test(poiName)) return campusCategoryLabels.transport
  if (/医院|医务|服务/.test(poiName)) return campusCategoryLabels.service
  return '校园地点'
}

function buildCampusPoiCard(name, location, events = [], lostFoundPosts = []) {
  const placeName = escapeHtml(name || location?.name || '校园地点')
  const category = escapeHtml(getCampusPoiCategory(name, location))
  const openStatusLabels = { open: '开放', limited: '部分开放', closed: '暂时关闭' }
  const crowdStatusLabels = { low: '人流较少', normal: '人流一般', busy: '当前拥挤' }
  const statusMarkup = location
    ? `<div class="tencent-poi-card__status"><span class="tencent-poi-card__status--${escapeHtml(location.openStatus)}">${escapeHtml(openStatusLabels[location.openStatus] ?? '状态未知')}</span><span class="tencent-poi-card__status--${escapeHtml(location.crowdStatus)}">${escapeHtml(crowdStatusLabels[location.crowdStatus] ?? '人流未知')}</span></div>`
    : ''
  const eventsMarkup = events.length > 0
    ? `<div class="tencent-poi-card__events"><strong>校园动态</strong>${events.slice(0, 2).map((event) => `<p><b>${escapeHtml(event.title)}</b><span>${escapeHtml(event.impact)}</span></p>`).join('')}</div>`
    : ''
  const communityAction = location && lostFoundPosts.length
    ? `<button class="tencent-poi-card__community" type="button" data-campus-poi-action="community" data-location-id="${escapeHtml(location.id)}">这里有 ${lostFoundPosts.length} 条寻找中的失物信息 · 查看</button>`
    : ''
  let externalUrl = ''
  try {
    const parsedUrl = new URL(location?.externalUrl)
    if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') externalUrl = parsedUrl.href
  } catch {
    // Ignore missing or invalid external URLs.
  }
  const description = location?.description && !location.description.startsWith('地图标注的')
    ? `<p class="tencent-poi-card__description">${escapeHtml(location.description)}</p>`
    : ''
  const websiteAction = canShowCampusLink(externalUrl)
    ? `<a class="tencent-poi-card__website" href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer" data-campus-poi-action="external"><span>访问官网</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 3h6v6m0-6-8 8"/><path d="M15 11v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a>`
    : ''
  const feedbackAction = location
    ? `<button class="tencent-poi-card__feedback" type="button" data-campus-poi-action="feedback" data-location-id="${escapeHtml(location.id)}"><span>反馈地点信息</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h12v9H9l-4 3V4Z"/><path d="M10 6.5v3m0 2.2h.01"/></svg></button>`
    : ''
  const routeAction = location
    ? `<button class="tencent-poi-card__route" type="button" data-campus-poi-action="route" data-location-id="${escapeHtml(location.id)}"><span>从当前位置规划</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg></button>`
    : ''

  return `<div class="tencent-poi-card" role="dialog" aria-label="${placeName}地点详情"><div class="tencent-poi-card__topline"><span class="tencent-poi-card__marker" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19 10.2c0 5-7 11-7 11s-7-6-7-11a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></svg></span><span class="tencent-poi-card__eyebrow">${category}</span><button class="tencent-poi-card__close" type="button" aria-label="关闭地点详情" data-campus-poi-action="close">×</button></div><strong class="tencent-poi-card__title">${placeName}</strong><div class="tencent-poi-card__campus"><span aria-hidden="true"></span>OurCampus · 本校区</div>${statusMarkup}${eventsMarkup}${communityAction}${description}${websiteAction}${feedbackAction}${routeAction}</div>`
}

function routeErrorMessage(error) {
  if (error?.code === 110 || error?.code === 112) return '腾讯路线接口未授权当前来源'
  if (error?.code === 121) return '腾讯路线接口今日免费额度已用完'
  if (error?.code === 347) return '腾讯地图暂时没有找到这条步行路线'
  if (error?.message === 'walking-route-timeout') return '腾讯步行路线请求超时'
  return '腾讯步行路线暂不可用'
}

export function TencentCampusMap({
  locations = [],
  events = [],
  lostFoundPosts = [],
  allLostFoundPosts = lostFoundPosts,
  selectedId = null,
  currentLocationId = null,
  livePosition = null,
  livePositionFocusToken = 0,
  routePlan = null,
  showLabels = true,
  showTips = true,
  resetViewToken = 0,
  onPlanRouteToLocation,
  onSelectLocation,
  onOpenFeedback,
  onRouteStateChange,
  onUseCampusMap,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const locationsRef = useRef(locations)
  const eventsRef = useRef(events)
  const lostFoundRef = useRef(allLostFoundPosts)
  const layersRef = useRef({ infoWindow: null, route: null, liveLocation: null, community: null, campusLabels: null })
  const selectCallbackRef = useRef(onSelectLocation)
  const routeCallbackRef = useRef(onPlanRouteToLocation)
  const feedbackCallbackRef = useRef(onOpenFeedback)
  const routeStateCallbackRef = useRef(onRouteStateChange)
  const lastResetTokenRef = useRef(resetViewToken)
  const lastLivePositionFocusTokenRef = useRef(0)
  const [loadState, setLoadState] = useState('loading')
  const [loadError, setLoadError] = useState('')
  const [zoomLevel, setZoomLevel] = useState(TENCENT_CAMPUS_ZOOM)
  const [routeState, setRouteState] = useState({ status: 'idle', route: null, message: '' })

  routeCallbackRef.current = onPlanRouteToLocation
  feedbackCallbackRef.current = onOpenFeedback
  routeStateCallbackRef.current = onRouteStateChange
  locationsRef.current = locations
  eventsRef.current = events
  lostFoundRef.current = allLostFoundPosts
  selectCallbackRef.current = onSelectLocation

  useEffect(() => {
    let disposed = false
    let map = null
    let removePoiCardActionListener = null

    loadTencentMapSdk(apiKey)
      .then((TMap) => {
        if (disposed || !containerRef.current) return
        map = new TMap.Map(containerRef.current, {
          center: new TMap.LatLng(TENCENT_CAMPUS_CENTER.lat, TENCENT_CAMPUS_CENTER.lng),
          zoom: TENCENT_CAMPUS_ZOOM,
          minZoom: TENCENT_CAMPUS_MIN_ZOOM,
          maxZoom: TENCENT_CAMPUS_MAX_ZOOM,
          pitch: 0,
          rotation: 0,
          viewMode: '3D',
          // 保留道路、绿地和二维建筑，底图文字统一由匿名校园标签代替。
          ...(COMPETITION_PRESENTATION ? { baseMap: { type: 'vector', features: ['base', 'building2d', 'arrow'], buildingRange: [14.5, 20] } } : {}),
          draggable: true,
          scrollable: true,
          touchZoomable: true,
          rotatable: true,
          pitchable: false,
          doubleClickZoom: true,
          showControl: false,
        })
        mapRef.current = map
        setZoomLevel(map.getZoom())
        map.on('zoom', () => setZoomLevel(Number(Number(map.getZoom()).toFixed(1))))
        const infoWindow = new TMap.InfoWindow({
          map,
          position: new TMap.LatLng(TENCENT_CAMPUS_CENTER.lat, TENCENT_CAMPUS_CENTER.lng),
          offset: { x: 0, y: -18 },
          content: '<div></div>',
          enableCustom: true,
          zIndex: 50,
        })
        infoWindow.close()
        layersRef.current.infoWindow = infoWindow

        const handlePoiCardAction = (event) => {
          const button = event.target?.closest?.('[data-campus-poi-action]')
          if (!button) return
          event.stopPropagation()
          const action = button.dataset.campusPoiAction
          if (action === 'external') return
          event.preventDefault()
          if (action === 'close') {
            infoWindow.close()
          } else if (action === 'route' && button.dataset.locationId) {
            infoWindow.close()
            routeCallbackRef.current?.(button.dataset.locationId)
          } else if (action === 'feedback' && button.dataset.locationId) {
            infoWindow.close()
            feedbackCallbackRef.current?.(button.dataset.locationId)
          } else if (action === 'community' && button.dataset.locationId) {
            infoWindow.close()
            selectCallbackRef.current?.(button.dataset.locationId)
          }
        }
        const mapElement = containerRef.current
        mapElement.addEventListener('click', handlePoiCardAction, true)
        removePoiCardActionListener = () => mapElement.removeEventListener('click', handlePoiCardAction, true)
        map.on('click', (event) => {
          const poiName = event?.poi?.name?.trim()
          const poiPosition = event?.poi?.latLng
          if (!poiName || !poiPosition || !isInsideCampusBounds(poiPosition, locationsRef.current)) {
            infoWindow.close()
            return
          }

          const locationId = findCampusLocationId(poiName, locationsRef.current)
          const location = locationsRef.current.find((item) => item.id === locationId)

          const lat = Number(typeof poiPosition.getLat === 'function' ? poiPosition.getLat() : poiPosition.lat)
          const lng = Number(typeof poiPosition.getLng === 'function' ? poiPosition.getLng() : poiPosition.lng)
          infoWindow.setPosition(new TMap.LatLng(lat, lng))
          const locationEvents = location ? eventsRef.current.filter((item) => item.locationId === location.id) : []
          const locationPosts = location ? lostFoundRef.current.filter((post) => post.locationId === location.id && post.status === 'active') : []
          infoWindow.setContent(buildCampusPoiCard(poiName, location, locationEvents, locationPosts))
          infoWindow.open()
        })
        setLoadState('ready')
        markStartupReady('map')
      })
      .catch((error) => {
        if (disposed) return
        setLoadError(error?.message === 'missing-key'
          ? '尚未配置腾讯地图 Key。'
          : '腾讯地图 SDK 加载失败，请检查网络和 Key。')
        setLoadState('error')
        markStartupReady('map')
      })

    return () => {
      disposed = true
      removePoiCardActionListener?.()
      const infoWindow = layersRef.current.infoWindow
      Object.values(layersRef.current).forEach((layer) => layer?.setMap?.(null))
      layersRef.current.campusLabels?.destroy?.()
      infoWindow?.destroy?.()
      layersRef.current = { infoWindow: null, route: null, liveLocation: null, community: null, campusLabels: null }
      map?.destroy?.()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const TMap = window.TMap
    const map = mapRef.current
    if (!COMPETITION_PRESENTATION || loadState !== 'ready' || !TMap || !map) return
    const geometries = locations.flatMap((location) => {
      const coordinates = getTencentCampusPosition(location)
      return coordinates ? [{
        id: location.id, styleId: 'campus', content: campusDisplayText(location.name),
        position: new TMap.LatLng(coordinates.lat, coordinates.lng),
        rank: location.id === selectedId ? 100 : location.category === 'living' ? 1 : 10,
      }] : []
    })
    if (!layersRef.current.campusLabels) {
      const labels = new TMap.MultiLabel({
        id: 'campus-anonymous-labels', map, isStopPropagation: true,
        collisionOptions: { sameSource: true },
        styles: { campus: new TMap.LabelStyle({
          color: '#34584e', strokeColor: '#fff', strokeWidth: 3, size: 13,
          alignment: 'center', verticalAlignment: 'middle',
        }) },
        geometries,
      })
      labels.on('click', (event) => {
        const location = locationsRef.current.find((item) => item.id === event.geometry?.id)
        const infoWindow = layersRef.current.infoWindow
        const coordinates = getTencentCampusPosition(location)
        if (!location || !infoWindow || !coordinates) return
        infoWindow.setPosition(new TMap.LatLng(coordinates.lat, coordinates.lng))
        infoWindow.setContent(buildCampusPoiCard(location.name, location,
          eventsRef.current.filter((item) => item.locationId === location.id),
          lostFoundRef.current.filter((item) => item.locationId === location.id && item.status === 'active')))
        infoWindow.open()
      })
      layersRef.current.campusLabels = labels
    } else {
      layersRef.current.campusLabels.setGeometries(geometries)
    }
    layersRef.current.campusLabels.setVisible(showLabels)
  }, [loadState, locations, selectedId, showLabels])

  useEffect(() => {
    const TMap = window.TMap
    const map = mapRef.current
    if (loadState !== 'ready' || !TMap || !map) return
    const byId = new Map(locations.map((location) => [location.id, location]))
    const hotspotIds = new Set(events.map((event) => event.locationId))
    const lostIds = new Set(lostFoundPosts.filter((post) => post.status === 'active').map((post) => post.locationId))
    const geometries = []
    for (const [type, ids] of [['hotspot', hotspotIds], ['lost', lostIds]]) {
      for (const locationId of ids) {
        const coordinates = getTencentCampusPosition(byId.get(locationId))
        if (!coordinates) continue
        geometries.push({ id: `${type}-${locationId}`, styleId: type === 'lost' && hotspotIds.has(locationId) ? 'lost-offset' : type,
          position: new TMap.LatLng(coordinates.lat, coordinates.lng), properties: { locationId } })
      }
    }
    if (!layersRef.current.community) {
      const layer = new TMap.MultiMarker({
        id: 'campus-community', map, minZoom: 15, isStopPropagation: true, zIndex: 8,
        styles: {
          hotspot: new TMap.MarkerStyle({ width: 32, height: 38, anchor: { x: 16, y: 38 }, src: '/assets/community-hotspot.svg' }),
          lost: new TMap.MarkerStyle({ width: 32, height: 38, anchor: { x: 16, y: 38 }, src: '/assets/community-lost.svg' }),
          'lost-offset': new TMap.MarkerStyle({ width: 32, height: 38, anchor: { x: -18, y: 38 }, src: '/assets/community-lost.svg' }),
        },
        geometries,
      })
      layer.on('click', (event) => {
        const locationId = event.geometry?.properties?.locationId
        if (locationId) { layersRef.current.infoWindow?.close(); selectCallbackRef.current?.(locationId) }
      })
      layersRef.current.community = layer
    } else layersRef.current.community.setGeometries(geometries)
  }, [loadState, locations, events, lostFoundPosts])

  useEffect(() => {
    const TMap = window.TMap
    const map = mapRef.current
    if (loadState !== 'ready' || !TMap || !map) return

    const route = routeState.status === 'success' ? routeState.route : null
    const routeGeometries = route?.points?.length
      ? [{
          id: 'tencent-walking-route',
          styleId: 'walking',
          paths: route.points.map((point) => new TMap.LatLng(point.lat, point.lng)),
        }]
      : []
    if (!layersRef.current.route) {
      const routeLayer = new TMap.MultiPolyline({
        id: 'tencent-walking-route',
        map,
        styles: {
          walking: new TMap.PolylineStyle({
            color: '#20b88a', width: 7, borderColor: '#ffffff', borderWidth: 3,
          }),
        },
        geometries: routeGeometries,
      })
      layersRef.current.route = routeLayer
    } else {
      layersRef.current.route.setGeometries(routeGeometries)
    }
  }, [loadState, routeState])

  useEffect(() => {
    const TMap = window.TMap
    const map = mapRef.current
    if (loadState !== 'ready' || !TMap || !map || !livePosition) return

    const position = new TMap.LatLng(livePosition.lat, livePosition.lng)
    const geometry = [{ id: 'device-location', styleId: 'device-location', position }]
    if (!layersRef.current.liveLocation) {
      layersRef.current.liveLocation = new TMap.MultiMarker({
        id: 'campus-device-location',
        map,
        styles: {
          'device-location': new TMap.MarkerStyle({
            width: 32,
            height: 32,
            anchor: { x: 16, y: 16 },
            src: liveLocationMarkerImage,
          }),
        },
        geometries: geometry,
      })
    } else {
      layersRef.current.liveLocation.setGeometries(geometry)
    }

    if (livePositionFocusToken > 0 && lastLivePositionFocusTokenRef.current !== livePositionFocusToken) {
      lastLivePositionFocusTokenRef.current = livePositionFocusToken
      map.panTo(position, { duration: 360 })
      map.zoomTo(Math.max(Number(map.getZoom()) || TENCENT_CAMPUS_ZOOM, 17), { duration: 300 })
    }
  }, [loadState, livePosition, livePositionFocusToken])

  useEffect(() => {
    const map = mapRef.current
    if (loadState !== 'ready' || !map) return
    const focusedLocation = locations.find((location) => location.id === selectedId)
      ?? locations.find((location) => location.id === currentLocationId)
    const position = getTencentCampusPosition(focusedLocation)
    if (position) map.panTo(new window.TMap.LatLng(position.lat, position.lng), { duration: 320 })
  }, [loadState, locations, selectedId, currentLocationId])

  useEffect(() => {
    const map = mapRef.current
    if (loadState !== 'ready' || !map || lastResetTokenRef.current === resetViewToken) return
    lastResetTokenRef.current = resetViewToken
    map.panTo(new window.TMap.LatLng(TENCENT_CAMPUS_CENTER.lat, TENCENT_CAMPUS_CENTER.lng), { duration: 260 })
    map.zoomTo(TENCENT_CAMPUS_ZOOM, { duration: 260 })
    map.rotateTo(0, { duration: 260 })
  }, [loadState, resetViewToken])

  useEffect(() => {
    if (!routePlan || routePlan.status !== 'preview') {
      setRouteState({ status: 'idle', route: null, message: '' })
      return undefined
    }
    const hasBlockedEdges = (routePlan.blockedEdgeIds?.length ?? 0) > 0
    if (routePlan.mode !== 'shortest' || hasBlockedEdges) {
      const nextState = {
        status: 'local',
        route: null,
        message: hasBlockedEdges
          ? `校园路网已避开 ${routePlan.blockedEdgeIds.length} 段封闭道路；分段指引见路线面板`
          : '该路线模式按校园路网预览；分段指引见路线面板',
      }
      setRouteState(nextState)
      routeStateCallbackRef.current?.({ ...nextState, originId: routePlan.originId, destinationId: routePlan.destinationId })
      return undefined
    }

    const origin = locations.find((location) => location.id === routePlan.originId)
    const destination = locations.find((location) => location.id === routePlan.destinationId)
    const from = getTencentCampusPosition(origin)
    const to = getTencentCampusPosition(destination)
    if (!from || !to) {
      const nextState = { status: 'error', route: null, message: '起终点暂无可用腾讯坐标' }
      setRouteState(nextState)
      routeStateCallbackRef.current?.({ ...nextState, originId: routePlan.originId, destinationId: routePlan.destinationId })
      return undefined
    }

    let active = true
    const loadingState = { status: 'loading', route: null, message: '' }
    setRouteState(loadingState)
    routeStateCallbackRef.current?.({ ...loadingState, originId: routePlan.originId, destinationId: routePlan.destinationId })
    requestTencentWalkingRoute({ key: apiKey, from, to })
      .then((route) => {
        if (!active) return
        const nextState = { status: 'success', route, message: '' }
        setRouteState(nextState)
        routeStateCallbackRef.current?.({ ...nextState, originId: routePlan.originId, destinationId: routePlan.destinationId })
      })
      .catch((error) => {
        if (!active) return
        const nextState = { status: 'error', route: null, message: routeErrorMessage(error) }
        setRouteState(nextState)
        routeStateCallbackRef.current?.({ ...nextState, originId: routePlan.originId, destinationId: routePlan.destinationId })
      })

    return () => { active = false }
  }, [routePlan?.originId, routePlan?.destinationId, routePlan?.mode, routePlan?.status, routePlan?.blockedEdgeIds?.join(','), locations])

  return (
    <div className="tencent-campus-map" aria-label="腾讯地图校园地图">
      <div className="tencent-campus-map__canvas" ref={containerRef} />
      {loadState === 'loading' && (
        <div className="tencent-campus-map__state"><span className="tencent-campus-map__spinner" />正在连接腾讯地图…</div>
      )}
      {loadState === 'error' && (
        <div className="tencent-campus-map__state tencent-campus-map__state--error">
          <strong>腾讯地图暂时无法加载</strong>
          <span>{loadError}</span>
          {onUseCampusMap
            ? <button type="button" onClick={onUseCampusMap}>切回校园引导图</button>
            : <span>请检查网络后重试。</span>}
        </div>
      )}
      {loadState === 'ready' && (
        <>
          <div className="tencent-campus-map__compass">
            <button type="button" aria-label="恢复地图朝北" title="恢复朝北" onClick={() => mapRef.current?.rotateTo(0, { duration: 240 })}>
              <span><Navigation size={17} /></span><small>N</small>
            </button>
          </div>
          <div className="tencent-campus-map__controls" aria-label="腾讯地图操作">
            <button type="button" aria-label="放大地图" title="放大" onClick={() => mapRef.current?.zoomTo(Math.min(mapRef.current.getZoom() + 1, TENCENT_CAMPUS_MAX_ZOOM), { duration: 180 })}><Plus size={15} /></button>
            <span>{zoomLevel.toFixed(1)}级</span>
            <button type="button" aria-label="缩小地图" title="缩小" onClick={() => mapRef.current?.zoomTo(Math.max(mapRef.current.getZoom() - 1, TENCENT_CAMPUS_MIN_ZOOM), { duration: 180 })}><Minus size={15} /></button>
            <button type="button" aria-label="回到本校区" title="回到校区" onClick={() => {
              mapRef.current?.panTo(new window.TMap.LatLng(TENCENT_CAMPUS_CENTER.lat, TENCENT_CAMPUS_CENTER.lng), { duration: 260 })
              mapRef.current?.zoomTo(TENCENT_CAMPUS_ZOOM, { duration: 260 })
              mapRef.current?.rotateTo(0, { duration: 260 })
            }}><LocateFixed size={14} /></button>
          </div>
          {showTips && <div className="tencent-campus-map__help">点击校园地点查看详情和路线 · 单指拖动，双指缩放或旋转</div>}
          {routeState.status === 'loading' && <div className="tencent-campus-map__route-note">正在请求腾讯步行路线…</div>}
          {routeState.status === 'success' && (
            <div className="tencent-campus-map__route-note">腾讯步行路线 · {routeState.route.distance} 米 · 约 {routeState.route.durationMinutes} 分钟</div>
          )}
          {routeState.status === 'error' && (
            <div className="tencent-campus-map__route-note">{routeState.message} · 腾讯路线暂未生成</div>
          )}
          {routeState.status === 'local' && <div className="tencent-campus-map__route-note">{routeState.message} · 路径仅供预览</div>}
        </>
      )}
    </div>
  )
}
