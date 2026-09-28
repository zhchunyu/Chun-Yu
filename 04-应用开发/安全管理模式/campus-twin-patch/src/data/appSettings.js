export const SETTINGS_STORAGE_KEY = 'campus-twin:app-state:v3-shared-3d-primary'

export const DEFAULT_SETTINGS = Object.freeze({
  showLabels: true,
  showHotspots: true,
  showRoute: true,
  showCurrentLocation: true,
  showStatusColors: true,
  showTips: true,
  defaultRouteMode: 'shortest',
  // ---- 安全管理模式（默认关闭，不改变既有默认体验）----
  safetyMode: false, // 是否开启安全管理模式（面板 + 叠加层）
  showRiskZones: true, // 风险区四色图层
  showCrowdHeat: true, // 人流热力图层
  showBlockedRoads: true, // 封控路段与推荐通道
})

const BOOLEAN_SETTING_KEYS = Object.freeze([
  'showLabels',
  'showHotspots',
  'showRoute',
  'showCurrentLocation',
  'showStatusColors',
  'showTips',
  'safetyMode',
  'showRiskZones',
  'showCrowdHeat',
  'showBlockedRoads',
])

export function mergeSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const settings = { ...DEFAULT_SETTINGS }

  BOOLEAN_SETTING_KEYS.forEach((key) => {
    if (typeof source[key] === 'boolean') settings[key] = source[key]
  })

  if (typeof source.defaultRouteMode === 'string') settings.defaultRouteMode = source.defaultRouteMode
  return settings
}
