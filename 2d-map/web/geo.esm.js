/* geo.js 的 ESM 包装（给 Three.js / Babylon 等打包器项目用）
 *
 * geo.js 本身是 UMD：普通 <script src="geo.js"> 引入后会挂到 window.CampusGeo。
 * 但 Vite / webpack 这类打包器里没法直接 import 一个 UMD 文件拿到具名导出，
 * 所以这里做一层两行的转发：
 *
 *   // 方式一（打包器，推荐）
 *   import G from './geo.js';                 // 其实是指向本文件
 *   G.dijkstra(graph, 'south_gate', 'E1');
 *
 *   // 方式二（普通 <script>，零配置）
 *   //   <script src="web/geo.js"></script>
 *   //   const G = window.CampusGeo;
 *
 *   // 方式三（Node 脚本）
 *   const G = require('./web/geo.js');
 *
 * 三种方式拿到的是同一个对象、同一份实现，不会出现"2D 和 3D 算法不一致"。
 */
import './geo.js';

const G = globalThis.CampusGeo;
if (!G) {
  throw new Error('geo.js 未正确加载：请确认 geo.esm.js 与 geo.js 在同一目录');
}

export default G;

// 常用函数的具名导出，方便 tree-shaking 与按需引用
export const {
  // 坐标与投影
  bboxOf, makePlanarProjection, eachCoord,
  // 距离与几何
  planarDist, lineLength, signedArea, polygonArea, polygonCentroid,
  // 寻路
  dijkstra, routeCoords, MinHeap,
  // 3D 对接（docs/08）
  DEFAULT_FLOOR_HEIGHT, buildingHeight, toThreeJS, toBabylonJS, fromThreeJS,
  // 格式化
  fmtDist, fmtTime,
} = G;
