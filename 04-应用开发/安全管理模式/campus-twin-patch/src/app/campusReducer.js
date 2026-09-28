import { canManage, canPublishEvents, isHotspotActiveAt } from '../domain/campus.js'
import { CAMERA_MODES } from '../domain/camera.js'
import { createDemoRoute, createUnavailableRoute, ROUTE_MODES } from '../domain/route.js'
import { DEFAULT_SETTINGS, mergeSettings } from '../data/appSettings.js'
import { teamCampusMap } from '../data/campusMap.js'
import { getActiveBlockedEdgeIds } from '../data/events.js'

function createRouteForState(state, overrides = {}, events = state.events) {
  const originId = overrides.originId ?? state.routePlan?.originId
  const destinationId = overrides.destinationId ?? state.routePlan?.destinationId
  const mode = overrides.mode ?? state.routePlan?.mode ?? state.settings.defaultRouteMode ?? ROUTE_MODES.SHORTEST
  if (!originId || !destinationId) return null

  const origin = state.locations.find((location) => location.id === originId)
  const destination = state.locations.find((location) => location.id === destinationId)

  if (origin?.openStatus === 'closed') {
    return createUnavailableRoute(originId, destinationId, mode, 'origin-closed')
  }
  if (destination?.openStatus === 'closed') {
    return createUnavailableRoute(originId, destinationId, mode, 'destination-closed')
  }

  return createDemoRoute({
    originId,
    destinationId,
    mode,
    blockedEdgeIds: getActiveBlockedEdgeIds(events),
  })
}

const PERSISTED_LOCATION_FIELDS = Object.freeze([
  'openStatus',
  'crowdStatus',
  'activity',
  'updatedAt',
  'updatedBy',
])

const MAX_ADMIN_HISTORY = 20

function appendAdminHistory(history, entry) {
  return [...history, entry].slice(-MAX_ADMIN_HISTORY)
}

function makeAdminAction({ type, targetId, label, before, after }) {
  return {
    id: `admin-action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    targetId,
    label,
    before,
    after,
    operator: '管理员（演示）',
    createdAt: new Date().toISOString(),
  }
}

function mergePersistedLocations(locations, persistedLocations) {
  if (!Array.isArray(persistedLocations)) return locations

  const persistedById = new Map(persistedLocations.map((location) => [location?.id, location]))
  return locations.map((location) => {
    const persisted = persistedById.get(location.id)
    if (!persisted) return location

    const runtimePatch = Object.fromEntries(
      PERSISTED_LOCATION_FIELDS
        .filter((field) => Object.prototype.hasOwnProperty.call(persisted, field))
        .map((field) => [field, persisted[field]]),
    )
    return { ...location, ...runtimePatch }
  })
}

function refreshExpiredDemoEventWindows(persistedEvents, demoEvents, now) {
  const demoEventsById = new Map(demoEvents.map((event) => [event.id, event]))

  return persistedEvents.map((event) => {
    if (event?.status !== 'active' || isHotspotActiveAt(event, now)) return event

    const demoEvent = demoEventsById.get(event.id)
    if (!demoEvent || !isHotspotActiveAt(demoEvent, now)) return event

    return { ...event, startAt: demoEvent.startAt, endAt: demoEvent.endAt }
  })
}

export function createInitialState(locations, events = [], persistedState = null) {
  const persisted = persistedState && typeof persistedState === 'object' ? persistedState : {}
  const now = Date.now()
  const nextLocations = mergePersistedLocations(locations, persisted.locations)
  const nextEvents = Array.isArray(persisted.events)
    ? refreshExpiredDemoEventWindows(persisted.events, events, now)
    : events
  const persistedCurrentLocation = persisted.currentLocationId
    && nextLocations.some((location) => location.id === persisted.currentLocationId)
    ? persisted.currentLocationId
    : null

  return {
    locations: nextLocations,
    events: nextEvents,
    adminHistory: Array.isArray(persisted.adminHistory) ? persisted.adminHistory.slice(-MAX_ADMIN_HISTORY) : [],
    eventTime: now,
    query: '',
    category: 'all',
    selectedId: null,
    currentLocationId: persistedCurrentLocation,
    mapScene: persisted.mapProfile === 'shared-3d-main' && persisted.mapScene === '2d'
      ? '2d'
      : teamCampusMap.defaultScene,
    cameraMode: persisted.cameraMode === CAMERA_MODES.FIRST_PERSON ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.ORBIT,
    role: ['visitor', 'student', 'manager'].includes(persisted.role) ? persisted.role : 'visitor',
    // ★ 安全模式属于"演示态"，不跨会话记忆：
    //   否则打开过一次 `?safety=1` 之后，普通 URL（`/`）也会带着上次的风险图层与
    //   叠加标签，看起来像"整合把原有默认体验弄坏了"。其余图层偏好照旧持久化。
    settings: mergeSettings({ ...DEFAULT_SETTINGS, ...persisted.settings, safetyMode: DEFAULT_SETTINGS.safetyMode }),
    toolbarOpen: false,
    activeTool: null,
    routePlan: null,
    lastSyncedAt: new Date(now).toISOString(),
    resetViewToken: 0,
  }
}

export function campusReducer(state, action) {
  switch (action.type) {
    case 'SET_MAP_SCENE':
      return { ...state, mapScene: action.scene === '2d' ? '2d' : '3d' }
    case 'REFRESH_EVENT_TIMELINE': {
      const eventTime = action.now ?? Date.now()
      const routePlan = state.routePlan
        ? createRouteForState(state, {}, state.events)
        : null

      return { ...state, eventTime, routePlan }
    }
    case 'SET_ROLE':
      return { ...state, role: action.role }
    case 'SET_QUERY':
      return { ...state, query: action.query }
    case 'SET_CATEGORY':
      return { ...state, category: action.category }
    case 'SELECT_LOCATION':
      return { ...state, selectedId: action.locationId }
    case 'SET_CURRENT_LOCATION': {
      const locationId = action.locationId ?? null
      if (locationId && !state.locations.some((location) => location.id === locationId)) return state

      const destinationId = state.routePlan?.destinationId ?? null
      const originId = locationId ?? 'east-gate'
      const routePlan = destinationId
        ? createRouteForState(state, {
            originId,
            destinationId,
            mode: state.routePlan?.mode ?? ROUTE_MODES.SHORTEST,
          })
        : null

      return { ...state, currentLocationId: locationId, routePlan }
    }
    case 'SET_CAMERA_MODE':
      return {
        ...state,
        cameraMode: action.mode === CAMERA_MODES.FIRST_PERSON ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.ORBIT,
      }
    case 'SET_SETTINGS':
      return { ...state, settings: mergeSettings({ ...state.settings, ...action.changes }) }
    case 'RESET_SETTINGS':
      return { ...state, settings: mergeSettings() }
    case 'RESET_VIEW':
      return { ...state, resetViewToken: state.resetViewToken + 1 }
    case 'CLEAR_SELECTED_LOCATION':
      return { ...state, selectedId: null }
    case 'TOGGLE_TOOLBAR':
      return { ...state, toolbarOpen: action.open ?? !state.toolbarOpen }
    case 'SET_ACTIVE_TOOL':
      return { ...state, activeTool: action.tool }
    case 'SET_ROUTE_ORIGIN': {
      const destinationId = state.routePlan?.destinationId ?? null
      return {
        ...state,
        routePlan: createRouteForState(state, {
          originId: action.originId,
          destinationId,
        }),
      }
    }
    case 'SET_ROUTE_DESTINATION': {
      const originId = state.routePlan?.originId ?? state.currentLocationId ?? 'east-gate'
      return {
        ...state,
        selectedId: action.destinationId,
        routePlan: createRouteForState(state, {
          originId,
          destinationId: action.destinationId,
        }),
      }
    }
    case 'PLAN_ROUTE': {
      const nextState = campusReducer(state, {
        type: 'SET_ROUTE_DESTINATION',
        destinationId: action.destinationId,
      })
      return { ...nextState, selectedId: null }
    }
    case 'SET_ROUTE_MODE':
      return state.routePlan
        ? {
            ...state,
            routePlan: createRouteForState(state, {
              originId: state.routePlan.originId,
              destinationId: state.routePlan.destinationId,
              mode: action.mode,
            }),
          }
        : state
    case 'CLEAR_ROUTE':
      return { ...state, routePlan: null }
    case 'SWAP_ROUTE_ENDPOINTS': {
      if (!state.routePlan) return state

      return {
        ...state,
        selectedId: state.routePlan.originId,
        routePlan: createRouteForState(state, {
          originId: state.routePlan.destinationId,
          destinationId: state.routePlan.originId,
          mode: state.routePlan.mode,
        }),
      }
    }
    case 'RESET_DEMO_DATA':
      return {
        ...state,
        locations: Array.isArray(action.locations) ? action.locations : state.locations,
        events: Array.isArray(action.events) ? action.events : state.events,
        adminHistory: [],
        selectedId: null,
        currentLocationId: null,
        routePlan: null,
        lastSyncedAt: new Date().toISOString(),
      }
    case 'UPDATE_LOCATION_STATUS': {
      if (!canManage(state.role)) return state

      const before = state.locations.find((location) => location.id === action.locationId)
      if (!before) return state
      const unchanged = Object.entries(action.changes ?? {}).every(([key, value]) => before[key] === value)
      if (unchanged) return state

      const after = {
        ...before,
        ...action.changes,
        updatedAt: new Date().toISOString(),
        updatedBy: '管理员（演示）',
      }
      const nextLocations = state.locations.map((location) => location.id === action.locationId ? after : location)
      return {
        ...state,
        locations: nextLocations,
        routePlan: state.routePlan ? createRouteForState({ ...state, locations: nextLocations }) : null,
        adminHistory: appendAdminHistory(state.adminHistory, makeAdminAction({
          type: 'location-update',
          targetId: before.id,
          label: `修改地点：${before.name}`,
          before,
          after,
        })),
        lastSyncedAt: new Date().toISOString(),
      }
    }
    case 'PUBLISH_EVENT': {
      if (!canPublishEvents(state.role)) return state

      const exists = state.events.some((event) => event.id === action.event.id)
      if (exists) return state

      const after = {
        ...action.event,
        updatedAt: new Date().toISOString(),
        updatedBy: '管理员（演示）',
      }
      const nextEvents = [...state.events, after]
      return {
        ...state,
        events: nextEvents,
        adminHistory: appendAdminHistory(state.adminHistory, makeAdminAction({
          type: 'event-create',
          targetId: after.id,
          label: `发布热点：${after.title}`,
          before: null,
          after,
        })),
        routePlan: state.routePlan ? createRouteForState(state, {}, nextEvents) : null,
        lastSyncedAt: new Date().toISOString(),
      }
    }
    case 'CLOSE_EVENT': {
      if (!canPublishEvents(state.role)) return state

      const before = state.events.find((event) => event.id === action.eventId)
      if (!before || before.status === 'closed') return state

      const updatedAt = new Date().toISOString()
      const nextEvents = state.events.map((event) => (
        event.id === action.eventId
          ? { ...event, status: 'closed', updatedAt, updatedBy: '管理员（演示）' }
          : event
      ))
      const after = nextEvents.find((event) => event.id === action.eventId)

      return {
        ...state,
        events: nextEvents,
        adminHistory: appendAdminHistory(state.adminHistory, makeAdminAction({
          type: 'event-close',
          targetId: before.id,
          label: `结束热点：${before.title}`,
          before,
          after,
        })),
        routePlan: state.routePlan ? createRouteForState(state, {}, nextEvents) : null,
        lastSyncedAt: new Date().toISOString(),
      }
    }
    case 'UPDATE_EVENT': {
      if (!canPublishEvents(state.role)) return state

      const before = state.events.find((event) => event.id === action.eventId)
      if (!before) return state

      const updatedAt = new Date().toISOString()
      const after = {
        ...before,
        ...action.changes,
        id: before.id,
        updatedAt,
        updatedBy: '管理员（演示）',
      }
      const nextEvents = state.events.map((event) => event.id === before.id ? after : event)

      return {
        ...state,
        events: nextEvents,
        adminHistory: appendAdminHistory(state.adminHistory, makeAdminAction({
          type: 'event-update',
          targetId: before.id,
          label: `修改热点：${after.title}`,
          before,
          after,
        })),
        routePlan: state.routePlan ? createRouteForState(state, {}, nextEvents) : null,
        lastSyncedAt: new Date().toISOString(),
      }
    }
    case 'UNDO_ADMIN_ACTION': {
      if (!canManage(state.role) || state.adminHistory.length === 0) return state

      const action = state.adminHistory.at(-1)
      const adminHistory = state.adminHistory.slice(0, -1)
      let locations = state.locations
      let events = state.events

      if (action.type === 'location-update') {
        locations = state.locations.map((location) => (
          location.id === action.targetId ? action.before : location
        ))
      } else if (action.type === 'event-create') {
        events = state.events.filter((event) => event.id !== action.targetId)
      } else if (action.type === 'event-close' || action.type === 'event-update') {
        events = state.events.map((event) => (
          event.id === action.targetId ? action.before : event
        ))
      } else {
        return state
      }

      return {
        ...state,
        locations,
        events,
        adminHistory,
        routePlan: state.routePlan ? createRouteForState(state, {}, events) : null,
        lastSyncedAt: new Date().toISOString(),
      }
    }
    default:
      return state
  }
}
