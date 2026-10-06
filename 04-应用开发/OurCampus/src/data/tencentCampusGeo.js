import { teamCampusMap } from './campusMap.js'

export const TENCENT_CAMPUS_CENTER = Object.freeze({ lat: 37.423038, lng: 112.583703 })
export const TENCENT_CAMPUS_ZOOM = 17

// 由西校门、牌楼、崇学楼、教学主楼和实验大楼的腾讯 POI 坐标校准。
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
const TENCENT_POI_POSITIONS = Object.freeze({
  'east-gate': { lat: 37.424548, lng: 112.578701 },
  paifang: { lat: 37.424444, lng: 112.579655 },
  'teaching-a': { lat: 37.425144, lng: 112.583579 },
  'main-teaching-building': { lat: 37.423786, lng: 112.585820 },
  'lab-building': { lat: 37.424905, lng: 112.581233 },
  'qinxue-building': { lat: 37.423319, lng: 112.578307 },
  'apartment-18': { lat: 37.423057, lng: 112.590528 },
})

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
  const { lngX, lngY, lngOffset, latX, latY, latOffset } = IMAGE_TO_GCJ02
  const lat = latX * imageX + latY * imageY + latOffset
  const lng = lngX * imageX + lngY * imageY + lngOffset

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}
