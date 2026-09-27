import { SETTINGS_STORAGE_KEY } from './appSettings.js'

function getStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadPersistedState() {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function savePersistedState(state) {
  const storage = getStorage()
  if (!storage) return

  const payload = {
    mapProfile: 'shared-3d-main',
    locations: state.locations,
    events: state.events,
    adminHistory: state.adminHistory,
    settings: state.settings,
    role: state.role,
    mapScene: state.mapScene,
    cameraMode: state.cameraMode,
    currentLocationId: state.currentLocationId,
  }

  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 存储不可用时保持演示继续运行，未来 API 接入不会依赖这里。
  }
}

export function clearPersistedState() {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.removeItem(SETTINGS_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}
