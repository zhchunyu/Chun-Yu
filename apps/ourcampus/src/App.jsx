import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { Compass, LayoutGrid, Radio } from 'lucide-react'
import { createLocalCampusDataSource } from './data/campusDataSource.js'
import { loadPersistedState, savePersistedState } from './data/appStorage.js'
import { teamCampusMap } from './data/campusMap.js'
import { campusDisplayRecord } from './data/campusPresentation.js'
import { eventRepository } from './data/events.js'
import { campusServices } from './data/campusServices.js'
import { describeLocationError, getDeviceLocation } from './data/deviceGeolocation.js'
import { wgs84ToGcj02 } from './data/tencentCampusGeo.js'
import { createFacilityContribution, createLostFoundPost, getCampusRegionId, loadCommunityState, LOCAL_AUTHOR_ID, MAX_LOCAL_POSTS, reviewFacilityContribution, saveCommunityState, updateLostFoundStatus } from './data/campusCommunity.js'
import { setReportStatus, submitCampusReport } from './data/campusInformation.js'
import { disablePushDevice } from './data/campusPush.js'
import { useCampusInformation } from './features/notifications/useCampusInformation.js'
import { useCampusPush } from './features/notifications/useCampusPush.js'
import { NotificationCenter } from './features/notifications/NotificationCenter.jsx'
import { locationRepository } from './data/locations.js'
import { listActiveHotspots, filterLocations, ROLE_LABELS } from './domain/campus.js'
import { createPlaceFeedback } from './domain/placeFeedback.js'
import { searchCampusResources } from './domain/search.js'
import { campusReducer, createInitialState } from './app/campusReducer.js'
import { LocationDetail } from './features/locations/LocationDetail.jsx'
import { PlaceFeedbackSheet } from './features/locations/PlaceFeedbackSheet.jsx'
import { ExplorePanel } from './features/mobile/ExplorePanel.jsx'
import { HallPanel } from './features/mobile/HallPanel.jsx'
import { LoginSheet } from './features/mobile/LoginSheet.jsx'
import { useCampusAuth } from './features/account/useCampusAuth.js'
import { markStartupReady } from './app/startup.js'
import { useRealtimeHall } from './features/mobile/useRealtimeHall.js'
import { MePanel } from './features/mobile/MePanel.jsx'
import { MobileTabBar } from './features/mobile/MobileTabBar.jsx'
import { TripPanel } from './features/mobile/TripPanel.jsx'
import { MapWorkspace } from './features/map/MapWorkspace.jsx'
import { RouteDock } from './features/routes/RouteDock.jsx'
import { RestaurantReviewsPage } from './features/reviews/RestaurantReviewsPage.jsx'
import { AuvAssistantPage } from './features/ai/AuvAssistantPage.jsx'
import { TimetablePage } from './features/timetable/TimetablePage.jsx'

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
    () => ({ ...createInitialState(initialSnapshot.locations, initialSnapshot.events, loadPersistedState()), role: 'visitor' }),
    [initialSnapshot],
  )
  const [storedState, dispatch] = useReducer(campusReducer, initialState)
  const auth = useCampusAuth()
  const information = useCampusInformation(auth.user?.id)
  const displayLocations = useMemo(() => storedState.locations.map(campusDisplayRecord), [storedState.locations])
  const displayEvents = useMemo(() => [...storedState.events, ...information.events].map(campusDisplayRecord), [storedState.events, information.events])
  const state = { ...storedState, locations: displayLocations, events: displayEvents }
  const [activeTab, setActiveTab] = useState('map')
  const [hallRegionId, setHallRegionId] = useState('all')
  const [hallSection, setHallSection] = useState('chat')
  const [hallLostFoundFilter, setHallLostFoundFilter] = useState('all')
  const [communityState, setCommunityState] = useState(loadCommunityState)
  const [informationOpen, setInformationOpen] = useState(false)
  const [informationSeed, setInformationSeed] = useState(null)
  const [noticeId, setNoticeId] = useState(null)
  const openInformation = useCallback((seed = null) => { setInformationSeed(seed); setNoticeId(null); setInformationOpen(true) }, [])
  const closeInformation = useCallback(() => { setInformationOpen(false); setNoticeId(null); setInformationSeed(null) }, [])
  const openNotice = useCallback((id) => { setInformationSeed(null); setNoticeId(id); setInformationOpen(true) }, [])
  const push = useCampusPush(auth.user?.id, openNotice)
  const communityPosts = useMemo(() => {
    const cloud = information.reports.filter((r) => ['lost', 'found'].includes(r.kind) && !['withdrawn', 'rejected'].includes(r.status)).map((r) => ({
      id: r.id, cloudReportId: r.id, isCloud: true, authorId: r.author_id, type: r.kind,
      title: r.details?.item_name || r.title, description: r.body, contact: r.details?.contact || '',
      locationId: r.location_id, locationDetail: r.details?.location_detail || '',
      regionId: getCampusRegionId(storedState.locations.find((l) => l.id === r.location_id)),
      occurredAt: r.details?.occurred_at || r.created_at, createdAt: r.created_at, updatedAt: r.updated_at,
      status: r.status === 'resolved' ? 'resolved' : 'active', image: communityState.posts.find((p) => p.cloudReportId === r.id)?.image || '',
    }))
    return [...cloud, ...communityState.posts.filter((p) => !p.cloudReportId)]
  }, [information.reports, communityState.posts, storedState.locations, auth.user?.id])
  const [tencentRouteState, setTencentRouteState] = useState(null)
  const [feedbackLocationId, setFeedbackLocationId] = useState(null)
  const [reviewLocationId, setReviewLocationId] = useState(null)
  const closeRestaurantReviews = useCallback(() => setReviewLocationId(null), [])
  const [auvOpen, setAuvOpen] = useState(false)
  const [auvSeed, setAuvSeed] = useState(null)
  const [timetableOpen, setTimetableOpen] = useState(false)
  const closeTimetable = useCallback(() => setTimetableOpen(false), [])
  const closeAuv = useCallback(() => setAuvOpen(false), [])
  const [devicePosition, setDevicePosition] = useState(null)
  const [deviceLocationStatus, setDeviceLocationStatus] = useState('idle')
  const [deviceLocationMessage, setDeviceLocationMessage] = useState('')
  const [devicePositionFocusToken, setDevicePositionFocusToken] = useState(0)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => markStartupReady('interface'))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    if (auth.status !== 'loading') markStartupReady('account')
  }, [auth.status])
  useEffect(() => { if (!auvOpen) setAuvSeed(null) }, [auvOpen])
  const chat = useRealtimeHall({ userId: auth.user?.id ?? null, regionId: hallRegionId })
  const [loginMode, setLoginMode] = useState(null)
  const openLogin = useCallback(() => setLoginMode('login'), [])
  const closeLogin = useCallback(() => setLoginMode(null), [])
  useEffect(() => { if (auth.user && noticeId) setInformationOpen(true) }, [auth.user?.id, noticeId])

  useEffect(() => {
    if (state.role !== auth.role) dispatch({ type: 'SET_ROLE', role: auth.role })
  }, [state.role, auth.role])
  useEffect(() => { if (auth.recoveryRequested) setLoginMode((current) => current ?? 'reset') }, [auth.recoveryRequested])

  useEffect(() => {
    savePersistedState(storedState)
  }, [storedState])

  useEffect(() => {
    const focusSearch = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      document.querySelector('.map-search-field input')?.focus()
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
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
  const feedbackLocation = state.locations.find((location) => location.id === feedbackLocationId) ?? null
  const reviewLocation = state.locations.find((location) => location.id === reviewLocationId) ?? null
  const lastAdminAction = state.adminHistory.at(-1) ?? null
  const canUndoAdminAction = state.role === 'manager'
    && ['location-update', 'event-create', 'event-close', 'event-update'].includes(lastAdminAction?.type)

  const handleSearchResult = (result) => {
    dispatch({ type: 'SELECT_LOCATION', locationId: result.locationId })
    dispatch({ type: 'SET_QUERY', query: '' })
  }

  const handleExploreLocation = (locationId) => {
    dispatch({ type: 'SELECT_LOCATION', locationId })
    dispatch({ type: 'SET_QUERY', query: '' })
    dispatch({ type: 'SET_CATEGORY', category: 'all' })
    setActiveTab('map')
  }

  const handlePlanRoute = ({ originId, destinationId }) => {
    dispatch({ type: 'SET_ROUTE_DESTINATION', destinationId })
    dispatch({ type: 'SET_ROUTE_ORIGIN', originId })
    dispatch({ type: 'CLEAR_SELECTED_LOCATION' })
  }

  const handlePlanRouteFromDetail = () => {
    if (!selectedLocation) return
    handlePlanRouteToLocation(selectedLocation.id)
  }

  const handlePlanRouteToLocation = (destinationId) => {
    dispatch({
      type: 'PLAN_ROUTE',
      originId: state.currentLocationId ?? 'east-gate',
      destinationId,
    })
    dispatch({ type: 'SET_QUERY', query: '' })
    dispatch({ type: 'SET_CATEGORY', category: 'all' })
    setActiveTab('map')
  }

  const handleLocateDevice = async () => {
    setDeviceLocationMessage('')
    setDeviceLocationStatus('loading')

    try {
      const position = await getDeviceLocation()
      setDevicePosition({ ...wgs84ToGcj02(position), accuracy: position.accuracy })
      setDevicePositionFocusToken((token) => token + 1)
      setDeviceLocationStatus('located')
    } catch (error) {
      setDeviceLocationMessage(describeLocationError(error))
      setDeviceLocationStatus('error')
    }
  }


  const updateCommunity = (next) => {
    saveCommunityState(next)
    setCommunityState(next)
  }
  const handleSubmitLostFound = async (input, editingId) => {
    const previous = editingId ? communityState.posts.find((post) => post.id === editingId) : null
    if (editingId && !previous) throw new Error('这条发布已不存在')
    if (previous?.cloudReportId) throw new Error('云端信息请先撤回，再重新发布')
    if (!previous && communityState.posts.length >= MAX_LOCAL_POSTS) throw new Error('请先删除一些本机发布，再添加新信息')
    const post = createLostFoundPost(input, state.locations, previous)
    if (input.syncToCloud) {
      if (!auth.user) { openLogin(); throw new Error('请先登录，登录后可继续发布') }
      post.cloudReportId = await submitCampusReport({ clientId: input.clientId, kind: post.type, title: post.title,
        body: post.description, locationId: post.locationId, details: { item_name: post.title, contact: post.contact,
          location_detail: post.locationDetail, occurred_at: post.occurredAt } })
      post.cloudOwnerId = auth.user.id
    }
    let warning = ''
    try { updateCommunity({ ...communityState, posts: previous ? communityState.posts.map((item) => item.id === post.id ? post : item) : [post, ...communityState.posts] }) }
    catch (error) { if (!post.cloudReportId) throw error; warning = '云端发布成功，但本机照片未能保存。' }
    if (post.cloudReportId) await information.refresh()
    return { cloud: Boolean(post.cloudReportId), warning }
  }
  const handleDeleteLostFound = async (id) => {
    const post = communityPosts.find((p) => p.id === id)
    if (!post || ![LOCAL_AUTHOR_ID, auth.user?.id].includes(post.authorId)) throw new Error('只能撤回自己发布的信息')
    if (post.cloudReportId) { await setReportStatus(post.cloudReportId, 'withdrawn'); await information.refresh() }
    updateCommunity({ ...communityState, posts: communityState.posts.filter((p) => p.id !== id && (!post.cloudReportId || p.cloudReportId !== post.cloudReportId)) })
  }
  const handleLostFoundStatus = async (id, status) => {
    const post = communityPosts.find((p) => p.id === id)
    if (post?.cloudReportId) {
      if (status !== 'resolved') throw new Error('已完成的云端信息不能重新开启，请重新发布')
      await setReportStatus(post.cloudReportId, status)
      updateCommunity({ ...communityState, posts: communityState.posts.map((p) => p.cloudReportId === post.cloudReportId ? { ...p, status } : p) })
      await information.refresh()
    } else updateCommunity({ ...communityState, posts: updateLostFoundStatus(communityState.posts, id, status) })
  }
  const handleSubmitFacility = (input) => {
    const facility = createFacilityContribution(input, state.locations)
    updateCommunity({ ...communityState, facilities: [facility, ...communityState.facilities] })
  }
  const handleReviewFacility = (id, status) => {
    updateCommunity({ ...communityState, facilities: reviewFacilityContribution(communityState.facilities, id, status, state.role) })
  }
  const handleOpenHall = (section, mine = false) => {
    setHallSection(section); setHallRegionId('all'); setHallLostFoundFilter(mine ? 'mine' : 'all'); setActiveTab('hall')
    dispatch({ type: 'CLEAR_SELECTED_LOCATION' })
  }

  const handleSubmitPlaceFeedback = async (input) => {
    if (input.syncToCloud) {
      if (!auth.user) { openLogin(); throw new Error('请先登录，再提交云端反馈') }
      const kind = ['construction', 'closure', 'crowd'].includes(input.type) ? input.type : input.type === 'facility-repair' ? 'repair' : 'feedback'
      await submitCampusReport({ clientId: input.clientId, kind, title: input.title || `${state.locations.find((l) => l.id === input.locationId)?.name || '校园地点'}反馈`,
        body: input.description, locationId: input.locationId, details: { repair_category: input.repairCategory || '', reported_end_at: input.reportedEndAt || null,
          crowd_status: input.crowdStatus || '', open_status: input.openStatus || '', suggested_description: input.suggestedDescription || '' } })
      await information.refresh()
      return { cloud: true }
    }
    dispatch({ type: 'SUBMIT_PLACE_FEEDBACK', feedback: createPlaceFeedback(input) })
    return { cloud: false }
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
        <div className="topbar__status"><Radio size={14} /> 二维校园地图 · 触控浏览 <span className="live-dot" /></div>
        <div className="topbar__right">
          <span className="topbar__role">当前视角：{ROLE_LABELS[state.role]}</span>
          <div className="topbar__avatar"><Compass size={15} /></div>
        </div>
      </header>

      <main className={`workspace workspace--tab-${activeTab}${state.routePlan ? ' workspace--has-route' : ''}`}>
        <MapWorkspace
          locations={state.locations}
          visibleLocations={filteredLocations}
          events={activeHotspots}
          searchResults={searchResults}
          selectedId={state.selectedId}
          query={state.query}
          category={state.category}
          toolbarOpen={state.toolbarOpen}
          activeTool={state.activeTool}
          role={state.role}
          settings={state.settings}
          resetViewToken={state.resetViewToken}
          currentLocationId={state.currentLocationId}
          livePosition={devicePosition}
          livePositionFocusToken={devicePositionFocusToken}
          deviceLocationStatus={deviceLocationStatus}
          deviceLocationMessage={deviceLocationMessage}
          routePlan={state.routePlan}
          onPublishEvent={(event) => dispatch({ type: 'PUBLISH_EVENT', event })}
          onUpdateEvent={(eventId, changes) => dispatch({ type: 'UPDATE_EVENT', eventId, changes })}
          onCloseEvent={(eventId) => dispatch({ type: 'CLOSE_EVENT', eventId })}
          canUndoAdminAction={canUndoAdminAction}
          lastAdminAction={lastAdminAction}
          onUndoAdminAction={() => dispatch({ type: 'UNDO_ADMIN_ACTION' })}
          onToggleToolbar={(open) => dispatch({ type: 'TOGGLE_TOOLBAR', open })}
          onToolChange={(tool) => dispatch({ type: 'SET_ACTIVE_TOOL', tool })}
          onRoleChange={undefined}
          onCurrentLocationChange={(locationId) => dispatch({ type: 'SET_CURRENT_LOCATION', locationId })}
          onSettingsChange={(changes) => dispatch({ type: 'SET_SETTINGS', changes })}
          onResetSettings={() => dispatch({ type: 'RESET_SETTINGS' })}
          onResetView={() => dispatch({ type: 'RESET_VIEW' })}
          onFullscreen={handleFullscreen}
          onClearRoute={() => dispatch({ type: 'CLEAR_ROUTE' })}
          onClearCurrentLocation={() => dispatch({ type: 'SET_CURRENT_LOCATION', locationId: null })}
          onLocateDevice={handleLocateDevice}
          onResetDemoData={() => dispatch({ type: 'RESET_DEMO_DATA', locations: initialSnapshot.locations, events: initialSnapshot.events })}
          onSelectLocation={(locationId) => dispatch({ type: 'SELECT_LOCATION', locationId })}
          onPlanRouteToLocation={handlePlanRouteToLocation}
          onOpenFeedback={setFeedbackLocationId}
          lostFoundPosts={communityPosts}
          onOpenHall={handleOpenHall}
          onRouteStateChange={setTencentRouteState}
          onQueryChange={(query) => dispatch({ type: 'SET_QUERY', query })}
          onSelectSearchResult={handleSearchResult}
          onCategoryChange={(category) => dispatch({ type: 'SET_CATEGORY', category })}
        />

        {activeTab === 'explore' && (
          <ExplorePanel
            locations={filteredLocations}
            allLocations={state.locations}
            calendarEvents={state.events}
            services={campusServices}
            facilityContributions={communityState.facilities}
            livePosition={devicePosition}
            deviceLocationStatus={deviceLocationStatus}
            deviceLocationMessage={deviceLocationMessage}
            onLocateDevice={handleLocateDevice}
            role={state.role}
            onSubmitFacility={handleSubmitFacility}
            onReviewFacility={handleReviewFacility}
            selectedId={state.selectedId}
            query={state.query}
            category={state.category}
            onQueryChange={(query) => dispatch({ type: 'SET_QUERY', query })}
            onCategoryChange={(category) => dispatch({ type: 'SET_CATEGORY', category })}
            onSelectLocation={handleExploreLocation}
            onPlanRouteToLocation={handlePlanRouteToLocation}
            onReset={() => {
              dispatch({ type: 'SET_QUERY', query: '' })
              dispatch({ type: 'SET_CATEGORY', category: 'all' })
            }}
          />
        )}
        {activeTab === 'hall' && (
          <HallPanel
            messages={chat.messages}
            selectedRegionId={hallRegionId}
            onRegionChange={setHallRegionId}
            onSendMessage={chat.sendMessage}
            chat={chat}
            auth={auth}
            onOpenLogin={openLogin}
            information={information}
            onOpenInformation={() => openInformation()}
            onPublishInformation={() => openInformation({ kind: 'notice' })}
            onSubmitAsInformation={(message) => openInformation({ kind: 'notice', title: message.content.slice(0, 60), body: message.content, sourceMessageId: message.id })}
            activeSection={hallSection}
            onOpenAuv={() => setAuvOpen(true)}
            onSectionChange={setHallSection}
            locations={state.locations}
            hotspots={activeHotspots}
            posts={communityPosts}
            lostFoundFilter={hallLostFoundFilter}
            onLostFoundFilterChange={setHallLostFoundFilter}
            onSubmitPost={handleSubmitLostFound}
            onPostStatusChange={handleLostFoundStatus}
            onDeletePost={handleDeleteLostFound}
            onSelectLocation={handleExploreLocation}
            onPlanRouteToLocation={handlePlanRouteToLocation}
            onOpenRestaurantReviews={setReviewLocationId}
            showLostFound={state.settings.showLostFound}
            onLostFoundMapChange={(showLostFound) => dispatch({ type: 'SET_SETTINGS', changes: { showLostFound } })}
          />
        )}
        {activeTab === 'routes' && (
          <TripPanel
            locations={state.locations}
            currentLocationId={state.currentLocationId}
            routePlan={state.routePlan}
            showRoute={state.settings.showRoute}
            onPlanRoute={handlePlanRoute}
            onOpenMap={() => setActiveTab('map')}
            onModeChange={(mode) => dispatch({ type: 'SET_ROUTE_MODE', mode })}
            onOriginChange={(originId) => dispatch({ type: 'SET_ROUTE_ORIGIN', originId })}
            onDestinationChange={(destinationId) => dispatch({ type: 'SET_ROUTE_DESTINATION', destinationId })}
            onSwap={() => dispatch({ type: 'SWAP_ROUTE_ENDPOINTS' })}
            onClear={() => dispatch({ type: 'CLEAR_ROUTE' })}
          />
        )}
        {activeTab === 'me' && (
          <MePanel
            onOpenTimetable={() => setTimetableOpen(true)}
            onOpenInformation={() => openInformation()}
            unreadCount={information.unread}
            onBeforeLogout={disablePushDevice}
            role={state.role}
            settings={state.settings}
            locations={state.locations}
            events={state.events}
            placeFeedback={state.placeFeedback}
            currentLocationId={state.currentLocationId}
            canUndoAdminAction={canUndoAdminAction}
            lastAdminAction={lastAdminAction}
            onRoleChange={undefined}
            auth={auth}
            onOpenLogin={openLogin}
            onCurrentLocationChange={(locationId) => dispatch({ type: 'SET_CURRENT_LOCATION', locationId })}
            onSettingsChange={(changes) => dispatch({ type: 'SET_SETTINGS', changes })}
            onResetSettings={() => dispatch({ type: 'RESET_SETTINGS' })}
            onResetView={() => dispatch({ type: 'RESET_VIEW' })}
            onFullscreen={handleFullscreen}
            onClearRoute={() => dispatch({ type: 'CLEAR_ROUTE' })}
            onResetDemoData={() => dispatch({ type: 'RESET_DEMO_DATA', locations: initialSnapshot.locations, events: initialSnapshot.events })}
            onUndoAdminAction={() => dispatch({ type: 'UNDO_ADMIN_ACTION' })}
            onPublishEvent={(event) => dispatch({ type: 'PUBLISH_EVENT', event })}
            onUpdateEvent={(eventId, changes) => dispatch({ type: 'UPDATE_EVENT', eventId, changes })}
            onCloseEvent={(eventId) => dispatch({ type: 'CLOSE_EVENT', eventId })}
            onReviewPlaceFeedback={(decision) => dispatch({ type: 'REVIEW_PLACE_FEEDBACK', ...decision })}
            onUpdateFacilityReport={(feedbackId, status) => dispatch({ type: 'SET_FACILITY_REPORT_STATUS', feedbackId, status })}
            favoriteLocationIds={state.favoriteLocationIds}
            savedRoutes={state.savedRoutes}
            lostFoundCount={communityPosts.filter((p) => p.authorId === LOCAL_AUTHOR_ID || p.authorId === auth.user?.id).length}
            onOpenMyLostFound={() => handleOpenHall('lost-found', true)}
            onSelectLocation={handleExploreLocation}
            onToggleFavorite={(locationId) => dispatch({ type: 'TOGGLE_FAVORITE_LOCATION', locationId })}
            onPlanSavedRoute={(route) => {
              dispatch({ type: 'PLAN_SAVED_ROUTE', routeId: route.id })
              setActiveTab('map')
            }}
            onRemoveSavedRoute={(routeId) => dispatch({ type: 'REMOVE_SAVED_ROUTE', routeId })}
          />
        )}

        {activeTab === 'map' && selectedLocation && (
          <LocationDetail
            location={selectedLocation}
            events={activeHotspots.filter((event) => event.locationId === selectedLocation.id)}
            lostFoundPosts={communityPosts.filter((post) => post.locationId === selectedLocation.id && post.status === 'active')}
            onOpenLostFound={() => handleOpenHall('lost-found')}
            onOpenReviews={() => setReviewLocationId(selectedLocation.id)}
            role={state.role}
            isFavorite={state.favoriteLocationIds.includes(selectedLocation.id)}
            onToggleFavorite={() => dispatch({ type: 'TOGGLE_FAVORITE_LOCATION', locationId: selectedLocation.id })}
            onClose={() => dispatch({ type: 'CLEAR_SELECTED_LOCATION' })}
            onPlanRoute={handlePlanRouteFromDetail}
            onUpdate={(changes) => dispatch({ type: 'UPDATE_LOCATION_STATUS', locationId: selectedLocation.id, changes })}
            onSubmitFeedback={handleSubmitPlaceFeedback}
          />
        )}
        {feedbackLocation && (
          <PlaceFeedbackSheet
            location={feedbackLocation}
            onClose={() => setFeedbackLocationId(null)}
            onSubmitFeedback={handleSubmitPlaceFeedback}
          />
        )}
        {activeTab === 'map' && state.routePlan && (
          <RouteDock
            routePlan={state.routePlan}
            locations={state.locations}
            routeResult={tencentRouteState}
            showRoute={state.settings.showRoute}
            onModeChange={(mode) => dispatch({ type: 'SET_ROUTE_MODE', mode })}
            onOriginChange={(originId) => dispatch({ type: 'SET_ROUTE_ORIGIN', originId })}
            onDestinationChange={(destinationId) => dispatch({ type: 'SET_ROUTE_DESTINATION', destinationId })}
            onSwap={() => dispatch({ type: 'SWAP_ROUTE_ENDPOINTS' })}
            onClear={() => dispatch({ type: 'CLEAR_ROUTE' })}
            isSaved={state.savedRoutes.some((route) => route.originId === state.routePlan.originId && route.destinationId === state.routePlan.destinationId && route.mode === state.routePlan.mode)}
            onSave={() => dispatch({ type: 'SAVE_ROUTE', routePlan: state.routePlan })}
          />
        )}
        <MobileTabBar activeTab={activeTab} onChange={setActiveTab} />
      </main>
      {loginMode && <LoginSheet key={loginMode} auth={auth} initialMode={loginMode} onClose={closeLogin} />}
      {informationOpen && <NotificationCenter key={auth.user?.id ?? 'guest'} auth={auth} information={information} push={push} locations={state.locations} initialDraft={informationSeed} noticeId={noticeId} onClose={closeInformation} onOpenLogin={() => { setInformationOpen(false); openLogin() }} onSelectLocation={(id) => { closeInformation(); handleExploreLocation(id) }} onPlanRouteToLocation={(id) => { closeInformation(); handlePlanRouteToLocation(id) }} />}
      {reviewLocation && <RestaurantReviewsPage key={`${reviewLocation.id}:${auth.user?.id ?? 'guest'}`} restaurant={reviewLocation} authorName={auth.profile?.nickname ?? '我'} role={auth.role} userId={auth.user?.id} onOpenLogin={openLogin} onClose={closeRestaurantReviews} />}
      {timetableOpen && <TimetablePage key={auth.user?.id ?? 'guest'} userId={auth.user?.id} onClose={closeTimetable} onAskAi={(prompt) => { setTimetableOpen(false); setAuvSeed({ userId: auth.user?.id ?? null, prompt }); setAuvOpen(true) }} />}
      {auvOpen && <AuvAssistantPage initialDraft={auvSeed?.userId === (auth.user?.id ?? null) ? auvSeed?.prompt ?? '' : ''} auth={auth} locations={state.locations} onClose={closeAuv} onOpenLogin={() => { setAuvOpen(false); openLogin() }} onSelectLocation={(id) => { setAuvOpen(false); handleExploreLocation(id) }} onPlanRouteToLocation={(id) => { setAuvOpen(false); handlePlanRouteToLocation(id) }} />}
    </div>
  )
}

export default App
