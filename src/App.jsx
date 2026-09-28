import { useEffect, useMemo, useReducer } from 'react'
import { Compass, LayoutGrid, Radio } from 'lucide-react'
import { createLocalCampusDataSource } from './data/campusDataSource.js'
import { loadPersistedState, savePersistedState } from './data/appStorage.js'
import { teamCampusMap } from './data/campusMap.js'
import { eventRepository } from './data/events.js'
import { locationRepository } from './data/locations.js'
import { listActiveHotspots, filterLocations, ROLE_LABELS } from './domain/campus.js'
import { searchCampusResources } from './domain/search.js'
import { campusReducer, createInitialState } from './app/campusReducer.js'
import { useSafetyState } from './app/useSafetyState.js'
import { LocationDetail } from './features/locations/LocationDetail.jsx'
import { MapWorkspace } from './features/map/MapWorkspace.jsx'
import { RouteDock } from './features/routes/RouteDock.jsx'

function loadInitialSnapshot() {
  const source = createLocalCampusDataSource({
    locations: locationRepository.loadAll(),
    events: eventRepository.loadAll(),
  })

  return source.loadSnapshot()
}

function App() {
  const initialSnapshot = useMemo(loadInitialSnapshot, [])
  const initialState = useMemo(
    () => createInitialState(initialSnapshot.locations, initialSnapshot.events, loadPersistedState()),
    [initialSnapshot],
  )
  const [state, dispatch] = useReducer(campusReducer, initialState)

  useEffect(() => {
    savePersistedState(state)
  }, [state])

  useEffect(() => {
    const focusSearch = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      document.querySelector('.map-search-field input')?.focus()
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  /**
   * ★ URL 开关：`?safety=1` 直接进入安全管理模式
   * 用途有两层：
   *   1. 演示与截图可以**定格**到指定态势，不必每次手点工具栏；
   *   2. 给评审一个可直接分享的深链接（例如方案书里写 `…/?safety=1`）。
   * 与 `?scene=2d` 配合可直达 2D 风险叠加层。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('safety')) return
    const on = params.get('safety') !== '0'
    dispatch({ type: 'SET_SETTINGS', changes: { safetyMode: on } })
    if (on) {
      dispatch({ type: 'TOGGLE_TOOLBAR', open: true })
      dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'safety' })
    }
    if (params.get('scene') === '2d') dispatch({ type: 'SET_MAP_SCENE', scene: '2d' })
    // 只在首次挂载时读取一次，之后交给用户操作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFullscreen = async () => {
    const mapWorkspace = document.querySelector('.map-workspace')
    if (!mapWorkspace) return

    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await mapWorkspace.requestFullscreen?.()
    } catch {
      // 浏览器不支持全屏时不影响地图继续使用。
    }
  }

  const activeHotspots = useMemo(
    () => listActiveHotspots(state.events, state.eventTime),
    [state.events, state.eventTime],
  )
  const searchResults = useMemo(
    () => searchCampusResources(state.query, {
      locations: state.locations,
      events: activeHotspots,
      category: state.category,
    }),
    [state.query, state.locations, activeHotspots, state.category],
  )
  const searchLocationIds = useMemo(
    () => new Set(searchResults.map((result) => result.locationId)),
    [searchResults],
  )
  const filteredLocations = useMemo(
    () => state.query.trim()
      ? state.locations.filter((location) => searchLocationIds.has(location.id))
      : filterLocations(state.locations, '', state.category),
    [state.locations, state.query, state.category, searchLocationIds],
  )
  const selectedLocation = state.locations.find((location) => location.id === state.selectedId) ?? null

  /**
   * ★ 安全管理模式态势
   * 用 `state.eventTime` 作为统一时钟，保证同一帧里风控、预警、SLA 用的是同一时刻。
   * 计算结果由 MapWorkspace 同时提供给**面板**与**地图叠加层**，
   * 两处共享同一份数据 —— 不会出现"面板说高风险、地图没画红圈"的不一致。
   */
  const safety = useSafetyState({
    locations: state.locations,
    events: activeHotspots,
    now: state.eventTime,
  })

  const handleSearchResult = (result) => {
    dispatch({ type: 'SELECT_LOCATION', locationId: result.locationId })
    dispatch({ type: 'SET_QUERY', query: '' })
  }

  useEffect(() => {
    const now = Date.now()
    const nextBoundary = state.events
      .filter((event) => event.status === 'active')
      .flatMap((event) => [event.startAt, event.endAt])
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now)
      .sort((a, b) => a - b)[0]

    if (!nextBoundary) return undefined

    const delay = Math.min(Math.max(nextBoundary - now + 20, 20), 2_147_483_647)
    const timer = window.setTimeout(() => {
      dispatch({ type: 'REFRESH_EVENT_TIMELINE', now: Date.now() })
    }, delay)

    return () => window.clearTimeout(timer)
  }, [state.events, state.eventTime])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><LayoutGrid size={19} strokeWidth={1.8} /></div>
          <div>
            <div className="brand-kicker">CAMPUSTWIN / DIGITAL CAMPUS</div>
            <h1>{teamCampusMap.campusName}</h1>
          </div>
        </div>
        <div className="topbar__status"><Radio size={14} /> 3D 主视角 · 2D 总览 <span className="live-dot" /></div>
        <div className="topbar__right">
          <span className="topbar__role">当前视角：{ROLE_LABELS[state.role]}</span>
          <div className="topbar__avatar"><Compass size={15} /></div>
        </div>
      </header>

      <main className="workspace">
        <MapWorkspace
          locations={state.locations}
          visibleLocations={filteredLocations}
          events={activeHotspots}
          safety={safety}
          now={state.eventTime}
          searchResults={searchResults}
          selectedId={state.selectedId}
          query={state.query}
          category={state.category}
          mapScene={state.mapScene}
          toolbarOpen={state.toolbarOpen}
          activeTool={state.activeTool}
          role={state.role}
          settings={state.settings}
          resetViewToken={state.resetViewToken}
          currentLocationId={state.currentLocationId}
          cameraMode={state.cameraMode}
          routePlan={state.routePlan}
          lastSyncedAt={state.lastSyncedAt}
          onPublishEvent={(event) => dispatch({ type: 'PUBLISH_EVENT', event })}
          onUpdateEvent={(eventId, changes) => dispatch({ type: 'UPDATE_EVENT', eventId, changes })}
          onCloseEvent={(eventId) => dispatch({ type: 'CLOSE_EVENT', eventId })}
          canUndoAdminAction={state.role === 'manager' && state.adminHistory.length > 0}
          lastAdminAction={state.adminHistory.at(-1) ?? null}
          onUndoAdminAction={() => dispatch({ type: 'UNDO_ADMIN_ACTION' })}
          onToggleToolbar={(open) => dispatch({ type: 'TOGGLE_TOOLBAR', open })}
          onToolChange={(tool) => dispatch({ type: 'SET_ACTIVE_TOOL', tool })}
          onRoleChange={(role) => dispatch({ type: 'SET_ROLE', role })}
          onCurrentLocationChange={(locationId) => dispatch({ type: 'SET_CURRENT_LOCATION', locationId })}
          onCameraModeChange={(mode) => dispatch({ type: 'SET_CAMERA_MODE', mode })}
          onSettingsChange={(changes) => dispatch({ type: 'SET_SETTINGS', changes })}
          onResetSettings={() => dispatch({ type: 'RESET_SETTINGS' })}
          onResetView={() => dispatch({ type: 'RESET_VIEW' })}
          onFullscreen={handleFullscreen}
          onClearRoute={() => dispatch({ type: 'CLEAR_ROUTE' })}
          onClearCurrentLocation={() => dispatch({ type: 'SET_CURRENT_LOCATION', locationId: null })}
          onResetDemoData={() => dispatch({ type: 'RESET_DEMO_DATA', locations: initialSnapshot.locations, events: initialSnapshot.events })}
          onSelectLocation={(locationId) => dispatch({ type: 'SELECT_LOCATION', locationId })}
          onQueryChange={(query) => dispatch({ type: 'SET_QUERY', query })}
          onSelectSearchResult={handleSearchResult}
          onCategoryChange={(category) => dispatch({ type: 'SET_CATEGORY', category })}
          onMapSceneChange={(scene) => dispatch({ type: 'SET_MAP_SCENE', scene })}
        />
        {selectedLocation && (
          <LocationDetail
            location={selectedLocation}
            events={activeHotspots.filter((event) => event.locationId === selectedLocation.id)}
            role={state.role}
            onClose={() => dispatch({ type: 'CLEAR_SELECTED_LOCATION' })}
            onPlanRoute={() => dispatch({ type: 'PLAN_ROUTE', destinationId: selectedLocation.id })}
            onUpdate={(changes) => dispatch({ type: 'UPDATE_LOCATION_STATUS', locationId: selectedLocation.id, changes })}
          />
        )}
        {state.routePlan && (
          <RouteDock
            routePlan={state.routePlan}
            locations={state.locations}
            showRoute={state.settings.showRoute}
            onModeChange={(mode) => dispatch({ type: 'SET_ROUTE_MODE', mode })}
            onOriginChange={(originId) => dispatch({ type: 'SET_ROUTE_ORIGIN', originId })}
            onDestinationChange={(destinationId) => dispatch({ type: 'SET_ROUTE_DESTINATION', destinationId })}
            onSwap={() => dispatch({ type: 'SWAP_ROUTE_ENDPOINTS' })}
            onClear={() => dispatch({ type: 'CLEAR_ROUTE' })}
          />
        )}
      </main>
    </div>
  )
}

export default App
