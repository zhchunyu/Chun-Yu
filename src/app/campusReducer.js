import { canManage, canPublishEvents } from '../domain/campus.js'
import { CAMERA_MODES } from '../domain/camera.js'
import { createDemoRoute, ROUTE_MODES } from '../domain/route.js'
import { DEFAULT_SETTINGS, mergeSettings } from '../data/appSettings.js'
import { teamCampusMap } from '../data/campusMap.js'
import { getActiveBlockedEdgeIds } from '../data/events.js'

function createRouteForState(state, overrides = {}, events = state.events) {
  return createDemoRoute({
    originId: overrides.originId ?? state.routePlan?.originId,
    destinationId: overrides.destinationId ?? state.routePlan?.destinationId,
    mode: overrides.mode ?? state.routePlan?.mode ?? state.settings.defaultRouteMode ?? ROUTE_MODES.SHORTEST,
    blockedEdgeIds: getActiveBlockedEdgeIds(events),
  })
}

const PERSISTED_LOCATION_FIELDS = Object.freeze([
  'openStatus',
  'crowdStatus',
  'activity',
  'updatedAt',
])

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

export function createInitialState(locations, events = [], persistedState = null) {
  const persisted = persistedState && typeof persistedState === 'object' ? persistedState : {}
  const nextLocations = mergePersistedLocations(locations, persisted.locations)
  const nextEvents = Array.isArray(persisted.events) ? persisted.events : events
  const persistedCurrentLocation = persisted.currentLocationId
    && nextLocations.some((location) => location.id === persisted.currentLocationId)
    ? persisted.currentLocationId
    : null

  return {
    locations: nextLocations,
    events: nextEvents,
    eventTime: Date.now(),
    query: '',
    category: 'all',
    selectedId: null,
    currentLocationId: persistedCurrentLocation,
    mapScene: persisted.mapProfile === 'shared-3d-main' && persisted.mapScene === '2d'
      ? '2d'
      : teamCampusMap.defaultScene,
    cameraMode: persisted.cameraMode === CAMERA_MODES.FIRST_PERSON ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.ORBIT,
    role: ['visitor', 'student', 'manager'].includes(persisted.role) ? persisted.role : 'visitor',
    settings: mergeSettings({ ...DEFAULT_SETTINGS, ...persisted.settings }),
    toolbarOpen: false,
    activeTool: null,
    routePlan: null,
    lastSyncedAt: '刚刚更新',
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
        selectedId: null,
        currentLocationId: null,
        routePlan: null,
        lastSyncedAt: '刚刚更新',
      }
    case 'UPDATE_LOCATION_STATUS': {
      if (!canManage(state.role)) return state

      const exists = state.locations.some((location) => location.id === action.locationId)
      if (!exists) return state

      return {
        ...state,
        locations: state.locations.map((location) =>
          location.id === action.locationId
            ? { ...location, ...action.changes, updatedAt: '刚刚更新' }
            : location,
        ),
        lastSyncedAt: '刚刚更新',
      }
      }
    case 'PUBLISH_EVENT': {
      if (!canPublishEvents(state.role)) return state

      const exists = state.events.some((event) => event.id === action.event.id)
      if (exists) return state

      const nextEvents = [...state.events, { ...action.event, updatedAt: '刚刚更新' }]
      return {
        ...state,
        events: nextEvents,
        routePlan: state.routePlan ? createRouteForState(state, {}, nextEvents) : null,
        lastSyncedAt: '刚刚更新',
      }
    }
    case 'CLOSE_EVENT': {
      if (!canPublishEvents(state.role)) return state

      const exists = state.events.some((event) => event.id === action.eventId)
      if (!exists) return state

      const nextEvents = state.events.map((event) => (
        event.id === action.eventId ? { ...event, status: 'closed', updatedAt: '刚刚更新' } : event
      ))

      return {
        ...state,
        events: nextEvents,
        routePlan: state.routePlan ? createRouteForState(state, {}, nextEvents) : null,
        lastSyncedAt: '刚刚更新',
      }
    }
    default:
      return state
  }
}
