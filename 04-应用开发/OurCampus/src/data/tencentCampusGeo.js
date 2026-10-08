import { teamCampusMap } from './campusMap.js'
import { locationRepository } from './locations.js'
import { TENCENT_POI_POSITIONS } from './tencentPoiPositions.js'

export const TENCENT_CAMPUS_CENTER = Object.freeze({ lat: 37.423038, lng: 112.583703 })
export const TENCENT_CAMPUS_ZOOM = 17
// 缩放下限锁定 14 级：再往外缩就会把校园缩成一小块，标签也会互相压住，因此禁止。
export const TENCENT_CAMPUS_MIN_ZOOM = 14
export const TENCENT_CAMPUS_MAX_ZOOM = 20

// 由西校门、牌楼、明德楼、教学主楼和实验大楼的腾讯 POI 坐标校准。
// 输入是校园引导图原图像素位置，输出为腾讯地图使用的 GCJ-02 坐标。
const IMAGE_TO_GCJ02 = Object.freeze({
  lngX: 0.000007751548461,
  lngY: -0.0000006366223844,
  lngOffset: 112.5767195,
  latX: -0.0000001422525562,
  latY: -0.00001222785281,
  latOffset: 37.42964987,
})

const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323
const GCJ_PI = Math.PI

function transformLatitude(x, y) {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3
  value += (20 * Math.sin(y * GCJ_PI) + 40 * Math.sin(y / 3 * GCJ_PI)) * 2 / 3
  value += (160 * Math.sin(y / 12 * GCJ_PI) + 320 * Math.sin(y * GCJ_PI / 30)) * 2 / 3
  return value
}

function transformLongitude(x, y) {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3
  value += (20 * Math.sin(x * GCJ_PI) + 40 * Math.sin(x / 3 * GCJ_PI)) * 2 / 3
  value += (150 * Math.sin(x / 12 * GCJ_PI) + 300 * Math.sin(x / 30 * GCJ_PI)) * 2 / 3
  return value
}

export function wgs84ToGcj02({ latitude, longitude }) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271) {
    return { lat: latitude, lng: longitude }
  }

  let latitudeDelta = transformLatitude(longitude - 105, latitude - 35)
  let longitudeDelta = transformLongitude(longitude - 105, latitude - 35)
  const radians = latitude / 180 * GCJ_PI
  let magic = Math.sin(radians)
  magic = 1 - GCJ_EE * magic * magic
  const rootMagic = Math.sqrt(magic)
  latitudeDelta = latitudeDelta * 180 / ((GCJ_A * (1 - GCJ_EE)) / (magic * rootMagic) * GCJ_PI)
  longitudeDelta = longitudeDelta * 180 / (GCJ_A / rootMagic * Math.cos(radians) * GCJ_PI)

  return { lat: latitude + latitudeDelta, lng: longitude + longitudeDelta }
}

export function getCampusMapPositionFromTencentPosition({ lat, lng }) {
  const { lngX, lngY, lngOffset, latX, latY, latOffset } = IMAGE_TO_GCJ02
  const determinant = lngX * latY - lngY * latX
  const longitudeDelta = lng - lngOffset
  const latitudeDelta = lat - latOffset
  const imageX = (longitudeDelta * latY - lngY * latitudeDelta) / determinant
  const imageY = (lngX * latitudeDelta - longitudeDelta * latX) / determinant
  const scene = teamCampusMap.scenes['2d']
  const normalizedX = (imageX / scene.imageWidth - scene.crop.x) / scene.crop.width
  const normalizedY = (imageY / scene.imageHeight - scene.crop.y) / scene.crop.height

  if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null
  return [normalizedX, normalizedY]
}

// 有独立腾讯 POI 坐标的地点直接使用实测点，避免只靠校园引导图外推。
// ★ 实测坐标表见 tencentPoiPositions.js，由 tools/harvest-tencent-poi.mjs 自动生成。
// ★ 系统误差校正：官方引导图是手绘示意图，全局仿射变换平均误差约 16 m（个别点 40 m）。
//   以实测 POI 点为控制点，把"实测 − 仿射"的残差按反距离权重平滑地加到其余地点上：
//   控制点处误差归零，邻近建筑获得同向修正，远处保持原状（不会引入新的偏差）。
const CONTROL_RESIDUALS = Object.freeze((() => {
  const scene = teamCampusMap.scenes['2d']
  if (!scene) return []
  const locations = locationRepository.loadAll()
  return Object.entries(TENCENT_POI_POSITIONS)
    .map(([id, exact]) => {
      const position = locations.find((item) => item.id === id)?.mapPosition?.['2d']
      if (!Array.isArray(position)) return null
      const imageX = (scene.crop.x + position[0] * scene.crop.width) * scene.imageWidth
      const imageY = (scene.crop.y + position[1] * scene.crop.height) * scene.imageHeight
      const base = applyAffine(imageX, imageY)
      return { imageX, imageY, dLat: exact.lat - base.lat, dLng: exact.lng - base.lng }
    })
    .filter(Boolean)
})())

function applyAffine(imageX, imageY) {
  const { lngX, lngY, lngOffset, latX, latY, latOffset } = IMAGE_TO_GCJ02
  return {
    lat: latX * imageX + latY * imageY + latOffset,
    lng: lngX * imageX + lngY * imageY + lngOffset,
  }
}

function residualCorrection(imageX, imageY) {
  let weightSum = 0, latSum = 0, lngSum = 0
  for (const control of CONTROL_RESIDUALS) {
    const distance = Math.hypot(imageX - control.imageX, imageY - control.imageY)
    if (distance < 1) return { lat: control.dLat, lng: control.dLng }
    // 反距离平方加权：越近修正越强，超过 1200 px（约等于整个校园）后影响自然衰减
    const weight = 1 / (distance * distance)
    weightSum += weight
    latSum += weight * control.dLat
    lngSum += weight * control.dLng
  }
  if (!weightSum) return { lat: 0, lng: 0 }
  return { lat: latSum / weightSum, lng: lngSum / weightSum }
}

export function getTencentCampusPosition(location) {
  const tencentPosition = TENCENT_POI_POSITIONS[location?.id]
  if (tencentPosition) return { ...tencentPosition }

  const position = location?.mapPosition?.['2d']
  const scene = teamCampusMap.scenes['2d']
  if (!Array.isArray(position) || position.length < 2 || !scene) return null

  const [normalizedX, normalizedY] = position
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null

  const imageX = (scene.crop.x + normalizedX * scene.crop.width) * scene.imageWidth
  const imageY = (scene.crop.y + normalizedY * scene.crop.height) * scene.imageHeight
  const base = applyAffine(imageX, imageY)
  const correction = residualCorrection(imageX, imageY)
  const lat = base.lat + correction.lat
  const lng = base.lng + correction.lng

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}
