// 腾讯 POI 实测坐标表（每个建筑一个精确点）
//
// 数据来源：腾讯地图 WebService 接口（逆地址解析 result.pois / 地点搜索）实测，
// 由 `tools/harvest-tencent-poi.mjs` 自动生成与更新 —— 不要手改，重新跑工具即可。
//
// ★ 作用：官方校园引导图是手绘示意图，用「图像像素 → 经纬度」的全局仿射换算会有
//   10~40 m 的系统误差，导致地图标注与真实建筑错位。凡是这里登记了 id 的建筑，
//   一律使用实测坐标，标注中心与建筑中心严格重合。
// ★ 未登记的建筑会退回「仿射 + 控制点残差校正」（见 tencentCampusGeo.js），
//   精度次之。想补齐就重跑采集工具。
export const TENCENT_POI_POSITIONS = Object.freeze({
  'east-gate': { lat: 37.424548, lng: 112.578701 },
  paifang: { lat: 37.424444, lng: 112.579655 },
  'teaching-a': { lat: 37.425144, lng: 112.583579 },
  'main-teaching-building': { lat: 37.423786, lng: 112.585820 },
  'lab-building': { lat: 37.424905, lng: 112.581233 },
  'qinxue-building': { lat: 37.423319, lng: 112.578307 },
  'apartment-18': { lat: 37.423057, lng: 112.590528 },
})
