/* preview.js —— 山河大学全园 GLB 预览
 * ------------------------------------------------------------------
 * 与产品 demo（index.html + src/app.js）**互不影响**：
 * 那一套是"实时态势地图"的产品原型，几何是程序化体块；
 * 这一页只做一件事 —— 把 Blender 导出的全园 GLB 放进来，验证模型本身。
 *
 * 坐标系：Blender (x, y, z) → three.js (x, z, −y)
 *   导出时用了 export_yup=True，所以 GLB 已经是 Y 向上，**不需要再手工转轴**。
 *   下面 PRESETS 里的数值是**已经换算过的 three.js 坐标**，
 *   来源是 `blender/configs/rN.json` 里各张成图的真实机位（见注释）。
 *
 * URL 参数：
 *   ?model=<url>     换模型
 *   ?preset=<名称>   直接进某个机位
 *   ?cam=x,y,z&tgt=x,y,z
 *   ?shadow=0        关阴影（SwiftShader 之类软渲染下快很多）
 *   ?trans=1         保留玻璃的 transmission（默认转成普通半透明，省一遍全屏折射渲染）
 *   ?night=1         夜景配色（产品 demo 那套调子）
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const Q = new URLSearchParams(location.search);
const qs = (k, d) => (Q.has(k) ? Q.get(k) : d);
const MODEL = qs('model', './assets/campus.glb');

/* ==================================================================
 * 1. 相机预设 —— 数值来自 blender/configs/rN.json 的真实机位
 *    （Blender 相机 + 36 mm 传感器 ⇒ 水平 FOV；three.js 的 fov 是垂直的，
 *      所以要按视口宽高比换算，见 fovFromLens）
 * ================================================================== */
const PRESETS = {
  // R6_滨水_鸟瞰   pos[0,-520,1080]  tgt[0,400,0]   lens 30
  '鸟瞰·全园': { cam: [0, 1080, 520], tgt: [0, 0, -400], lens: 30 },
  // R4_环廊_鸟瞰
  '环廊·鸟瞰': { cam: [300, 700, 520], tgt: [0, 10, -350], lens: 36 },
  // R5_五区_鸟瞰
  '五区·鸟瞰': { cam: [-560, 480, 430], tgt: [0, 30, -420], lens: 42 },
  // R1_山门_透视
  '山门·透视': { cam: [-175, 62, 165], tgt: [10, 28, -40], lens: 50 },
  // R0_垂直书院_中轴近景（52 mm / pos[0,330,88] / tgt[0,648,48]）
  '中轴·书院': { cam: [0, 88, -330], tgt: [0, 48, -648], lens: 52 },
  // R2_图书馆_中轴
  '中轴·图书馆': { cam: [0, 40, -300], tgt: [0, 24, -518], lens: 40 },
  // R6_滨水_近景
  '滨水·近景': { cam: [-128, 5, -856], tgt: [96, 3, -849], lens: 36 },
};
const NAMES = Object.keys(PRESETS);

/** Blender 镜头（36 mm 水平传感器）→ three.js 垂直 fov（度） */
function fovFromLens(lens, aspect) {
  return 2 * Math.atan((18 / lens) / aspect) * 180 / Math.PI;
}

/* ==================================================================
 * 2. 渲染器 / 场景 / 光照
 * ================================================================== */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
// 与 Blender 侧的 `view_transform = 'Khronos PBR Neutral'` 对齐
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const NIGHT = qs('night', '0') === '1';
const scene = new THREE.Scene();
if (NIGHT) {
  scene.background = new THREE.Color(0x0b1220);
  scene.fog = new THREE.Fog(0x0b1220, 1800, 5200);
} else {
  scene.background = new THREE.Color(0xb9cbdb);
  scene.fog = new THREE.Fog(0xb9cbdb, 2600, 7000);
}

const camera = new THREE.PerspectiveCamera(
  fovFromLens(30, innerWidth / innerHeight), innerWidth / innerHeight, 1, 30000);
camera.position.set(0, 1080, 520);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.495;   // 不许钻到地面以下
controls.minDistance = 20;
controls.maxDistance = 6000;
controls.target.set(0, 0, -400);

/* ---- 光照：参数取自 blender/configs/lighting.json ----
 * sun_elev 38° / sun_azim 220°（0°=东 +X，90°=北 +Y，逆时针）
 * 太阳方向 = (cos(az)·cos(el), sin(az)·cos(el), sin(el))，再转到 three.js 轴系 */
const EL = 38 * Math.PI / 180, AZ = 220 * Math.PI / 180;
const sunDir = new THREE.Vector3(
  Math.cos(AZ) * Math.cos(EL),   // → three.x
  Math.sin(EL),                  // → three.y
  -Math.sin(AZ) * Math.cos(EL),  // → three.z（Blender +Y = three −Z）
).normalize();

if (NIGHT) {
  scene.add(new THREE.HemisphereLight(0x4a7fb5, 0x0a1220, 0.55));
  const moon = new THREE.DirectionalLight(0x9fc7ff, 1.6);
  moon.position.copy(sunDir).multiplyScalar(1500);
  scene.add(moon);
} else {
  // ★ 光照强度要**克制**：three.js 的漫反射是 `albedo · I · NdotL / π`，
  //   而 `scene.environment`（PMREM 天空）本身还会给一份**不小的环境辐照**。
  //   两者叠加时很容易过曝 —— 第一版用了 hemi 1.15 + dir 2.35 + env(默认 1.0)，
  //   整个园区被推成一片白，连深色的水面都发白。
  //   这里把 hemi/ambient 压到很低，环境光交给 environmentIntensity 控制。
  scene.add(new THREE.HemisphereLight(0xcfe0ee, 0x6d6455, 0.40));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.20);
  sun.position.copy(sunDir).multiplyScalar(2200);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.06));

  if (qs('shadow', '1') === '1') {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    // 园区主体 X ±816 / Y 0~1238（→ three Z −1238~0），加一圈余量
    c.left = -1000; c.right = 1000; c.top = 1000; c.bottom = -1000;
    c.near = 200; c.far = 5200;
    sun.target.position.set(0, 0, -620);
    scene.add(sun.target);
  }
}

/* ==================================================================
 * 3. 加载 GLB
 * ================================================================== */
const t0 = performance.now();
const bar = document.getElementById('load-bar');
const txt = document.getElementById('load-txt');
const loadBox = document.getElementById('load');

const loader = new GLTFLoader();
// ★ Draco 是**必需**扩展（extensionsRequired 里有 KHR_draco_mesh_compression）：
//   不给 DRACOLoader，GLTFLoader 会直接抛错，而不是"少几个面"。
const draco = new DRACOLoader();
draco.setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);

let model = null, triTotal = 0, meshCount = 0, matCount = 0;

loader.load(MODEL, (gltf) => {
  model = gltf.scene;

  const keepTrans = qs('trans', '0') === '1';
  const mats = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    meshCount++;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = true;
    const m = o.material;
    if (!m || mats.has(m.uuid)) return;
    mats.set(m.uuid, 1);
    // 玻璃的 transmission 会触发 three 的折射渲染通道（整屏再渲一遍）。
    // 百万面级场景里这个代价太高 ⇒ 默认转成普通半透明。
    if (m.transmission > 0 && !keepTrans) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.34;
      m.depthWrite = false;
    }
    // glTF 的金属度/粗糙度来自 Blender 的 Principled BSDF，直接用；
    // 只把环境反射补上，否则金属件在无环境贴图时发黑。
  });
  matCount = mats.size;

  model.traverse((o) => {
    if (o.isMesh && o.geometry.index) triTotal += o.geometry.index.count / 3;
    else if (o.isMesh && o.geometry.attributes.position) {
      triTotal += o.geometry.attributes.position.count / 3;
    }
  });

  scene.add(model);

  // 金属件需要环境反射 —— 用一个程序化天空做 PMREM，不引外部 HDRI
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = scene.background.clone();
  const env = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = env;
  // ★ 默认的 1.0 相当于给全场景又加了一盏"天光"，会把浅色材质顶到过曝。
  //   压到 0.3：金属仍有反射，漫反射不再被额外提亮。
  scene.environmentIntensity = 0.30;
  pmrem.dispose();

  // ---- 面板数据 ----
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const dt = performance.now() - t0;
  document.getElementById('m-file').textContent = MODEL.split('/').pop();
  document.getElementById('m-tri').textContent = Math.round(triTotal).toLocaleString();
  document.getElementById('m-mesh').textContent = meshCount + ' / ' + matCount;
  document.getElementById('m-load').textContent = dt.toFixed(0) + ' ms';
  document.getElementById('m-size').textContent =
    size.x.toFixed(0) + ' × ' + size.z.toFixed(0) + ' × ' + size.y.toFixed(0) + ' m';

  const bad = document.getElementById('s-dist');
  bad.textContent = '—';

  loadBox.classList.add('done');
  // ★ 只在"没显式给机位"时才套默认预设 ——
  //   否则 `?cam=…&tgt=…` 会先被套上、再被默认预设覆盖掉（等于参数无效）。
  if (!Q.has('cam') && !Q.has('tgt')) {
    applyPreset(qs('preset', NAMES[0]), false);
  } else {
    if (Q.has('preset')) applyPreset(Q.get('preset'), false);
    camera.updateProjectionMatrix();
  }
}, (e) => {
  if (e.total) bar.style.width = (e.loaded / e.total * 100).toFixed(0) + '%';
  txt.textContent = (e.loaded / 1048576).toFixed(1) + ' MB'
    + (e.total ? ' / ' + (e.total / 1048576).toFixed(1) + ' MB' : '');
}, (err) => {
  console.error(err);
  txt.outerHTML = '<div class="err">模型加载失败：' + (err && err.message ? err.message : err)
    + '<br>请确认已通过 HTTP 打开（<code>python -m http.server 8123</code>），'
    + '且 <code>assets/campus.glb</code> 存在。</div>';
});

/* ==================================================================
 * 4. 相机预设 / 交互
 * ================================================================== */
const presetBox = document.getElementById('presets');
const buttons = {};
NAMES.forEach((n, i) => {
  const b = document.createElement('button');
  b.textContent = n;
  b.onclick = () => applyPreset(n, true);
  presetBox.appendChild(b);
  buttons[n] = b;
});

let tween = null;

function applyPreset(name, animate = true) {
  const p = PRESETS[name];
  if (!p) return;
  NAMES.forEach((n) => buttons[n].classList.toggle('on', n === name));
  const toPos = new THREE.Vector3(...p.cam);
  const toTgt = new THREE.Vector3(...p.tgt);
  const toFov = fovFromLens(p.lens, innerWidth / innerHeight);
  if (!animate) {
    camera.position.copy(toPos);
    controls.target.copy(toTgt);
    camera.fov = toFov;
    camera.updateProjectionMatrix();
    return;
  }
  tween = {
    t: 0,
    p0: camera.position.clone(), p1: toPos,
    t0: controls.target.clone(), t1: toTgt,
    f0: camera.fov, f1: toFov,
  };
}

addEventListener('keydown', (e) => {
  const i = parseInt(e.key, 10);
  if (i >= 1 && i <= NAMES.length) applyPreset(NAMES[i - 1]);
  if (e.key === 'r' || e.key === 'R') controls.autoRotate = !controls.autoRotate;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* URL 直接给机位 */
if (Q.has('cam')) {
  camera.position.fromArray(Q.get('cam').split(',').map(Number));
}
if (Q.has('tgt')) {
  controls.target.fromArray(Q.get('tgt').split(',').map(Number));
}
controls.autoRotateSpeed = 0.35;

/* ==================================================================
 * 5. 主循环
 * ================================================================== */
const sFps = document.getElementById('s-fps');
const sTri = document.getElementById('s-tri');
const sCall = document.getElementById('s-call');
const sDist = document.getElementById('s-dist');
let last = performance.now(), acc = 0, frames = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(now - last, 100); last = now;

  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 900);
    const k = tween.t < 0.5 ? 2 * tween.t * tween.t
      : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;      // easeInOutQuad
    camera.position.lerpVectors(tween.p0, tween.p1, k);
    controls.target.lerpVectors(tween.t0, tween.t1, k);
    camera.fov = tween.f0 + (tween.f1 - tween.f0) * k;
    camera.updateProjectionMatrix();
    if (tween.t >= 1) tween = null;
  }

  controls.update();
  renderer.render(scene, camera);

  acc += dt; frames++;
  if (acc >= 500) {
    sFps.textContent = (frames * 1000 / acc).toFixed(0);
    sTri.textContent = (renderer.info.render.triangles / 1000).toFixed(0) + 'k';
    sCall.textContent = renderer.info.render.calls;
    sDist.textContent = camera.position.distanceTo(controls.target).toFixed(0) + ' m';
    acc = 0; frames = 0;
  }
}
requestAnimationFrame(tick);

/* 调试：把统计挂到 window，方便无头截图时读 */
window.__preview = () => ({
  tri: Math.round(triTotal), mesh: meshCount, mat: matCount,
  calls: renderer.info.render.calls,
  drawn: renderer.info.render.triangles,
  pos: camera.position.toArray().map((v) => +v.toFixed(1)),
  ready: !!model,
});
