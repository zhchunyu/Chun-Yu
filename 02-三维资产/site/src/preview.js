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
 *   ?quality=high|balanced|perf
 *                    画质分级（默认 balanced）。三档只改「分辨率 / 阴影」，
 *                    不改几何、不改配色 —— 所以任何档位下看到的都是同一座校园。
 *   ?dpr=1.25        单独覆盖设备像素比（默认按档位取 min(devicePixelRatio, 档位值)）
 *   ?shadow=0        单独关阴影（SwiftShader 之类软渲染下快很多）
 *   ?smapsize=1024   单独覆盖阴影贴图边长
 *   ?softshadow=0    把 PCFSoft 降成 PCF
 *   ?aa=0            关 MSAA
 *   ?adapt=0         关自适应分辨率（默认开：帧率持续偏低时自动降 dpr）
 *   ?trans=1         保留玻璃的 transmission（默认转成普通半透明，省一遍全屏折射渲染）
 *   ?night=1         夜景配色（产品 demo 那套调子）
 *
 * ★★ 画质分级的依据是**实测**，不是拍脑袋（见 99-临时工作区/_perf_probe.py）：
 *   同机位 A/B 实测（1280×720 / SwiftShader）：
 *     · 阴影 autoUpdate=true   → drawn 2,765,364 / calls 605
 *     · 阴影 autoUpdate=false  → drawn 1,230,177 / calls 213   ← **阴影仍在画面上**
 *     · 阴影完全关闭           → drawn 1,230,177 / calls 213
 *   ⇒ 阴影**每帧重算**是最大单一大头（让每帧提交的面数与 draw call 各翻一倍）。
 *     太阳与校园几何都静止，阴影贴图**只需算一次**。
 *   另测 dpr：1.5 → 2.0 使帧耗时 ×1.66 ⇒ 高 DPI 屏上把 dpr 压到 1.5 收益很大。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  BUILDINGS, findBuilding, getBuildingNames,
  computeRoute, RouteRenderer, BuildingHighlighter,
  setAIConfig, AI_CONFIG,
  parseNaturalLanguage, generateRouteDescription,
} from './navigation.js';

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
/* ------------------------------------------------------------------
 * 画质分级（2026-09-26 加）
 * ------------------------------------------------------------------
 * 三档只动「像素数」和「阴影」，**不动几何、不动配色** ——
 * 任何档位下看到的都是同一座校园，只是清晰度与阴影精度不同。
 * 这样"降画质"不会变成"换了个东西"，对外包装成软件时也好解释。
 * ------------------------------------------------------------------ */
const TIER = qs('quality', 'balanced');
const TIERS = {
  //              dpr 上限          阴影   贴图   PCFSoft  MSAA
  // ★ 贴图边长保持 2048：既然阴影**只算一次**，贴图大小只影响"载入时那一次"的
  //   一次性开销，对每帧代价毫无影响 ⇒ 没有理由为了性能把它调小、牺牲阴影精度。
  high:     { dpr: 2.0, shadow: 1, map: 2048, soft: 1, aa: 1 },
  balanced: { dpr: 1.5, shadow: 1, map: 2048, soft: 1, aa: 1 },
  perf:     { dpr: 1.0, shadow: 0, map: 0,    soft: 0, aa: 0 },
};
const T = TIERS[TIER] || TIERS.balanced;

const DPR       = parseFloat(qs('dpr', String(Math.min(devicePixelRatio, T.dpr))));
const SHADOW    = qs('shadow', String(T.shadow)) === '1';
const SHADOW_MAP= parseInt(qs('smapsize', String(T.map || 1024)), 10);
const SOFT_SHADOW = qs('softshadow', String(T.soft)) === '1';
const ADAPT     = qs('adapt', '1') === '1';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: qs('aa', String(T.aa)) === '1',
});
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
// 与 Blender 侧的 `view_transform = 'Khronos PBR Neutral'` 对齐
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

/* ---- 自适应分辨率 ----
 * ★ 只调 pixelRatio，**不在运行时开关阴影**：
 *   改 `shadowMap.enabled` 会让 three.js 重编所有材质程序（本场景 54 个），
 *   切换瞬间反而更卡。降 dpr 是唯一"平滑且可逆"的旋钮。
 * ★ 只降不升（单调），避免在阈值附近来回抖。 */
let curDpr = DPR;
const DPR_FLOOR = 0.75;
let adaptAcc = 0, adaptFrames = 0, adaptSettled = 0;
function adaptQuality(dt) {
  if (!ADAPT || curDpr <= DPR_FLOOR) return;
  adaptAcc += dt; adaptFrames++;
  if (adaptAcc < 1500) return;                    // 每 1.5 s 判一次
  const fps = adaptFrames * 1000 / adaptAcc;
  adaptAcc = 0; adaptFrames = 0;
  if (fps < 28) {
    // 连续两次偏低才降，且降幅 25%
    if (++adaptSettled >= 2) {
      adaptSettled = 0;
      const next = Math.max(DPR_FLOOR, +(curDpr * 0.75).toFixed(2));
      if (next < curDpr) {
        curDpr = next;
        renderer.setPixelRatio(curDpr);
        renderer.setSize(innerWidth, innerHeight, false);
        window.__dpr = curDpr;
      }
    }
  } else {
    adaptSettled = 0;
  }
}

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

  if (SHADOW) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = SOFT_SHADOW ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // ★★ 阴影贴图**只算一次**（2026-09-26 改，本次优化收益最大的一处）★★
    //   实测（同机位、同视口）：
    //     autoUpdate=true  → 每帧 drawn 2,765,364 / calls 605
    //     autoUpdate=false → 每帧 drawn 1,230,177 / calls 213，**而画面上的阴影一模一样**
    //     enabled=false    → 每帧 drawn 1,230,177 / calls 213
    //   ⇒ 校园几何与太阳都是静止的，阴影贴图没有任何理由每帧重算。
    //     关掉 autoUpdate 后，阴影的**观感代价为零、渲染代价归零**。
    //   ★ 什么时候必须重新置 needsUpdate：几何变了、太阳方向变了、
    //     或**模型刚加载完**（见 loader.load 里 scene.add(model) 之后那一次）。
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;      // 兜底渲一次；模型到位后会再置一次
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const c = sun.shadow.camera;
    // 园区主体 X ±816 / Y 0~1238（→ three Z −1238~0），加一圈余量
    c.left = -1000; c.right = 1000; c.top = 1000; c.bottom = -1000;
    c.near = 200; c.far = 5200;
    sun.target.position.set(0, 0, -620);
    scene.add(sun.target);
    window.__sun = sun;
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

/* --------------------------------------------------------------------------
 * 统一失败出口（2026-09-25 加）
 * --------------------------------------------------------------------------
 * ★ 为什么必须有它（真实故障，不是假想）：
 *   原来隐藏遮罩的 `loadBox.classList.add('done')` 写在 onLoad 回调的**靠后**位置，
 *   而它前面还有 `PMREMGenerator.fromScene()` 生成环境贴图这一段。
 *   ⇒ 中间**任何一步抛异常**，遮罩就永远不消失，而且**页面上一个错都不报**。
 *
 *   更讽刺的是：本文件本来准备了一段很友好的提示（"请确认已通过 HTTP 打开…"），
 *   但它挂在 GLTFLoader 的 error 回调里 —— 只覆盖"模型下载/解析失败"这一种情况。
 *   脚本自己没跑起来、或 onLoad 中途抛异常，那段提示永远不会出现。
 *   用户看到的就是"3D 预览一直转圈"，无从判断问题在哪。
 *
 * ★ 现在的保证：**任何异常都在遮罩上可见**，并带上协议与地址，便于一眼定位。
 *   `__failed` 是幂等锁 —— 否则 `txt.outerHTML` 会被二次替换而报错。
 *
 * ★ `__ready` 与 `model` 是**两个不同的东西**，别合并（2026-09-25 踩过）：
 *   `model = gltf.scene` 在 `scene.add(model)` **之前**就赋值了，
 *   所以"model 非空"并不代表"画面已经能看了" —— traverse 中途抛异常时 model 也是非空。
 *   若用 `!model` 做超时判据，那种情况就永远等不到兜底。
 *   ⇒ 用 `__ready`（= 遮罩已隐藏、画面已可看）做唯一判据。
 * -------------------------------------------------------------------------- */
let __failed = false;
let __ready = false;
function fail(err, extra) {
  if (__failed) return;
  __failed = true;
  // 画面已经能看了就别再用错误提示盖住它 —— 只留控制台警告
  if (__ready) {
    console.warn('[preview] 就绪后发生异常（不影响显示）：', err, extra || '');
    return;
  }
  try {
    loadBox.classList.remove('done');       // 出错必须让遮罩可见
    txt.outerHTML = '<div class="err">预览失败：'
      + ((err && err.message) || err)
      + '<br>协议：<code>' + location.protocol + '</code>'
      + '　地址：<code>' + location.href + '</code>'
      + (extra ? '<br>' + extra : '')
      + '<br>请通过 HTTP 打开（<code>python -m http.server 8123</code>，'
      + '或双击站点目录下的 <code>serve.cmd</code>），'
      + '并确认 <code>assets/campus.glb</code> 存在。</div>';
  } catch (e) {
    console.error('[preview] 连错误提示都写不进去', e);
  }
}

// 兜底 1：主线程未捕获异常
addEventListener('error', (e) => fail(e.error || e.message));
// 兜底 2：未处理的 Promise 拒绝
addEventListener('unhandledrejection', (e) => fail(e.reason));
// 兜底 3：**超时**。上面两条都拦不住"请求发出去但永远不回来"这种情况
//   （比如 CDN 卡住、wasm 编译死等）。45 s 远大于正常加载（实测约 1.4 s）。
setTimeout(() => {
  if (!__ready) {
    fail(new Error('加载超时（45 s）'),
      '状态：' + JSON.stringify(window.__preview ? window.__preview() : null));
  }
}, 45000);

/* 模型**已就绪**之后的非致命步骤（环境贴图 / 面板数字 / 机位预设）。
 * ★ 关键：这些失败**绝不能**把遮罩盖回去 —— 那会让一个本来能看的场景被错误提示糊住。
 *   所以它们不走 `fail()`，只警告。 */
function soft(what, fn) {
  try {
    fn();
  } catch (e) {
    console.warn('[preview] ' + what + ' 失败（不影响模型显示）', e);
  }
}

loader.load(MODEL, (gltf) => {
  try {
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

    // ★ 阴影贴图**只在载入后算这一次**（配合上面的 `autoUpdate = false`）。
    //   必须放在 `scene.add(model)` **之后** —— 否则阴影 pass 渲染的是空场景，
    //   得到一张全空的阴影贴图，而且**不会报任何错**，表现为"阴影凭空消失"。
    if (SHADOW) renderer.shadowMap.needsUpdate = true;

    // ★★ 遮罩**在这里**就隐藏（2026-09-25 修）★★
    //   原来这句在函数末尾（面板数字之后）。而它前面还有 PMREM 环境贴图生成，
    //   中间任何一步抛异常 ⇒ 遮罩永不消失且不报错 ⇒ 表现为"3D 预览一直转圈"。
    //   现在：模型已入场景、下面的 tick() 循环在跑，**下一帧就能出图**，
    //   后面的环境贴图 / 面板数字 / 机位预设都只是附加信息，不该阻塞出图。
    loadBox.classList.add('done');
    __ready = true;              // ★ 唯一就绪判据（见 fail() 上方注释）

    // 初始化 AI 导航
    try {
      initNavigation();
      window.__navInited = true;
    } catch (e) {
      console.warn('导航初始化失败:', e);
      window.__navInitError = e.message;
    }

    // 金属件需要环境反射 —— 用一个程序化天空做 PMREM，不引外部 HDRI
    soft('环境贴图生成', () => {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = scene.background.clone();
      const env = pmrem.fromScene(envScene, 0.04).texture;
      scene.environment = env;
      // ★ 默认的 1.0 相当于给全场景又加了一盏"天光"，会把浅色材质顶到过曝。
      //   压到 0.3：金属仍有反射，漫反射不再被额外提亮。
      scene.environmentIntensity = 0.30;
      pmrem.dispose();
    });

    // ---- 面板数据 ----
    soft('面板数据', () => {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const dt = performance.now() - t0;
      document.getElementById('m-file').textContent = MODEL.split('/').pop();
      document.getElementById('m-tri').textContent = Math.round(triTotal).toLocaleString();
      document.getElementById('m-mesh').textContent = meshCount + ' / ' + matCount;
      document.getElementById('m-load').textContent = dt.toFixed(0) + ' ms';
      document.getElementById('m-size').textContent =
        size.x.toFixed(0) + ' × ' + size.z.toFixed(0) + ' × ' + size.y.toFixed(0) + ' m';
      document.getElementById('s-dist').textContent = '—';
    });

    // ★ 只在"没显式给机位"时才套默认预设 ——
    //   否则 `?cam=…&tgt=…` 会先被套上、再被默认预设覆盖掉（等于参数无效）。
    soft('机位预设', () => {
      if (!Q.has('cam') && !Q.has('tgt')) {
        applyPreset(qs('preset', NAMES[0]), false);
      } else {
        if (Q.has('preset')) applyPreset(Q.get('preset'), false);
        camera.updateProjectionMatrix();
      }
    });
  } catch (e) {
    fail(e);
  }
}, (e) => {
  if (e.total) bar.style.width = (e.loaded / e.total * 100).toFixed(0) + '%';
  txt.textContent = (e.loaded / 1048576).toFixed(1) + ' MB'
    + (e.total ? ' / ' + (e.total / 1048576).toFixed(1) + ' MB' : '');
}, (err) => {
  // 统一走 fail()，错误提示里带上协议与地址 —— 便于一眼看出是不是 file:// 的问题
  console.error(err);
  fail(err);
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
  // ★ 用 curDpr（自适应后的当前值），不是初始 DPR —— 否则一改窗口大小，
  //   自适应降下来的分辨率就被"还原"回去了。
  renderer.setPixelRatio(curDpr);
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
// ★ 特效动画的时间基准：页面自己的单调时钟（替代已废弃的 performance.timing.navigationStart）
const T0 = performance.now();
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

  // 导航相机动画
  if (navTween) {
    navTween.t = Math.min(1, navTween.t + dt / 1200);
    const k = navTween.t < 0.5 ? 2 * navTween.t * navTween.t
      : 1 - Math.pow(-2 * navTween.t + 2, 2) / 2;
    camera.position.lerpVectors(navTween.p0, navTween.p1, k);
    controls.target.lerpVectors(navTween.t0, navTween.t1, k);
    camera.fov = navTween.f0 + (navTween.f1 - navTween.f0) * k;
    camera.updateProjectionMatrix();
    if (navTween.t >= 1) navTween = null;
  }

  controls.update();

  // —— 特效动画必须在 `render()` **之前**更新 ——
  // ★ 原来这两段写在 render() 之后，于是特效的每帧动画**永远晚一帧**才呈现：
  //   相机动画已经在推进了，而光柱/光晕还停在上一帧的位置与不透明度上。
  //   单看一帧看不出来，动起来就是"光晕跟不紧"。
  // ★ 时间基准也不能再用 `performance.timing.navigationStart`（已废弃，
  //   新标准里为 0）—— 换成页面自己的单调时钟，且用秒为单位。
  const tSec = (now - T0) / 1000;

  // —— 导航路径动画 ——
  if (routeRenderer) routeRenderer.update(tSec);

  // —— 建筑高亮动画 ——
  if (buildingHighlighter) buildingHighlighter.update(tSec);

  renderer.render(scene, camera);

  adaptQuality(dt);

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

/* 调试：把统计挂到 window，方便无头截图时读。
 * ★ `ready` 用 `__ready`（= 遮罩已隐藏、画面已可看），**不是** `!!model` ——
 *   model 在 scene.add 之前就赋值了，用它当就绪判据会误报"已就绪"。 */
window.__preview = () => ({
  tri: Math.round(triTotal), mesh: meshCount, mat: matCount,
  calls: renderer.info.render.calls,
  drawn: renderer.info.render.triangles,
  pos: camera.position.toArray().map((v) => +v.toFixed(1)),
  ready: __ready,
  failed: __failed,
  proto: location.protocol,
  tier: TIER, dpr: curDpr, shadow: SHADOW,
});

/* ==================================================================
 * 6. AI 智能导航功能
 * ================================================================== */
let routeRenderer = null;
let buildingHighlighter = null;
let currentRoute = null;
let navTween = null;   // 导航相机动画（独立于预设 tween）

function $(id) { return document.getElementById(id); }

function initNavigation() {
  routeRenderer = new RouteRenderer(scene);
  buildingHighlighter = new BuildingHighlighter(scene, camera, canvas);

  // 点击建筑高亮
  canvas.addEventListener('click', (e) => {
    // 忽略面板上的点击
    if (e.target.closest('.panel')) return;

    buildingHighlighter.setMouse(e.clientX, e.clientY);
    const building = buildingHighlighter.checkClick();
    if (building) {
      buildingHighlighter.highlight(building);
    } else {
      buildingHighlighter.clearHighlight();
    }
  });

  const el = {
    panel: $('nav-panel'),
    close: $('nav-close'),
    from: $('nav-from'),
    to: $('nav-to'),
    go: $('nav-go'),
    fromSuggest: $('nav-from-suggest'),
    toSuggest: $('nav-to-suggest'),
    result: $('nav-result'),
    rFrom: $('nri-from'),
    rTo: $('nri-to'),
    rDist: $('nri-dist'),
    rTime: $('nri-time'),
    rDesc: $('nri-desc'),
    // AI 模式
    tabs: document.querySelectorAll('.nav-tab'),
    classic: $('nav-classic'),
    ai: $('nav-ai'),
    aiInput: $('nav-ai-input'),
    aiGo: $('nav-ai-go'),
    aiStatus: $('nav-ai-status'),
    aiConfigBtn: $('nav-ai-config'),
    configModal: $('ai-config-modal'),
    configKey: $('ai-api-key'),
    configUrl: $('ai-api-url'),
    configModel: $('ai-model'),
    configSave: $('ai-config-save'),
    configCancel: $('ai-config-cancel'),
  };

  // 收起/展开面板
  let collapsed = false;
  el.close.addEventListener('click', () => {
    collapsed = !collapsed;
    el.panel.style.height = collapsed ? '44px' : '';
    el.panel.style.overflow = collapsed ? 'hidden' : '';
    el.close.textContent = collapsed ? '+' : '—';
  });

  // 模式切换
  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.tabs.forEach(t => t.classList.remove('on'));
      tab.classList.add('on');
      const mode = tab.dataset.mode;
      if (mode === 'classic') {
        el.classic.style.display = 'block';
        el.ai.style.display = 'none';
      } else {
        el.classic.style.display = 'none';
        el.ai.style.display = 'block';
      }
    });
  });

  // —— 自动补全 ——
  const allNames = getBuildingNames();

  function setupSuggest(input, suggestBox) {
    let activeIndex = -1;
    let matches = [];

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (!val) {
        suggestBox.classList.add('hidden');
        return;
      }
      matches = allNames.filter(n =>
        n.includes(val) || val.split('').every(c => n.includes(c))
      ).slice(0, 8);

      if (matches.length === 0) {
        suggestBox.classList.add('hidden');
        return;
      }

      activeIndex = -1;
      suggestBox.innerHTML = matches.map((n, i) =>
        `<div class="suggest-item" data-i="${i}">${n}</div>`
      ).join('');
      suggestBox.classList.remove('hidden');
    });

    input.addEventListener('keydown', (e) => {
      if (suggestBox.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, matches.length - 1);
        updateActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0) {
          input.value = matches[activeIndex];
          suggestBox.classList.add('hidden');
        }
      } else if (e.key === 'Escape') {
        suggestBox.classList.add('hidden');
      }
    });

    function updateActive() {
      suggestBox.querySelectorAll('.suggest-item').forEach((item, i) => {
        item.classList.toggle('active', i === activeIndex);
      });
    }

    suggestBox.addEventListener('click', (e) => {
      const item = e.target.closest('.suggest-item');
      if (item) {
        input.value = item.textContent;
        suggestBox.classList.add('hidden');
        input.focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-input-wrap')) {
        suggestBox.classList.add('hidden');
      }
    });
  }

  setupSuggest(el.from, el.fromSuggest);
  setupSuggest(el.to, el.toSuggest);

  // —— 经典模式导航 ——
  el.go.addEventListener('click', () => handleNavigate(el));
  el.from.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleNavigate(el);
  });
  el.to.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleNavigate(el);
  });

  // —— AI 模式导航 ——
  el.aiGo.addEventListener('click', () => handleAINavigate(el));
  el.aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAINavigate(el);
    }
  });

  // —— AI 配置 ——
  el.aiConfigBtn.addEventListener('click', () => {
    el.configKey.value = AI_CONFIG.apiKey || '';
    el.configUrl.value = AI_CONFIG.baseUrl || '';
    el.configModel.value = AI_CONFIG.model || '';
    el.configModal.classList.remove('hidden');
  });

  el.configCancel.addEventListener('click', () => {
    el.configModal.classList.add('hidden');
  });

  el.configSave.addEventListener('click', () => {
    setAIConfig({
      apiKey: el.configKey.value.trim(),
      baseUrl: el.configUrl.value.trim(),
      model: el.configModel.value.trim(),
    });
    el.configModal.classList.add('hidden');
    updateAIStatus(el);
  });

  // 初始化 AI 状态
  updateAIStatus(el);

  // 调试：暴露到 window
  // ★ 这里多暴露 renderer/scene/camera —— 是**纯读取**，不改变任何渲染行为，
  //   但让性能量具能在**同一页面、同一机位**下做 A/B（例如运行时开关阴影、
  //   改 pixelRatio），从而把"阴影到底占多少"直接量出来，而不是靠推算。
  window.__debugNav = {
    handleNavigate: () => handleNavigate(el),
    findBuilding,
    computeRoute,
    routeRenderer,
    buildingHighlighter,
    BUILDINGS,
    renderer,
    scene,
    camera,
    controls,
  };
}

function updateAIStatus(el) {
  if (AI_CONFIG.apiKey) {
    el.aiStatus.textContent = '已启用';
    el.aiStatus.previousElementSibling.style.background = '#4caf50';
  } else {
    el.aiStatus.textContent = '未配置';
    el.aiStatus.previousElementSibling.style.background = '#888';
  }
}

async function handleNavigate(el) {
  const fromName = el.from.value.trim();
  const toName = el.to.value.trim();

  if (!fromName || !toName) {
    alert('请输入起点和终点');
    return;
  }

  const from = findBuilding(fromName);
  const to = findBuilding(toName);

  if (!from) { alert('找不到起点：' + fromName); return; }
  if (!to) { alert('找不到终点：' + toName); return; }

  const route = await computeRoute(fromName, toName);
  if (!route) {
    alert('无法规划路线');
    return;
  }

  currentRoute = route;
  routeRenderer.showRoute(route);

  // 显示结果
  el.rFrom.textContent = from.name;
  el.rTo.textContent = to.name;
  el.rDist.textContent = Math.round(route.distance) + ' 米';
  el.rTime.textContent = '约 ' + Math.round(route.distance / 70) + ' 分钟';
  el.result.classList.remove('hidden');

  // 生成 AI 描述
  el.rDesc.textContent = '正在生成路线指引…';
  try {
    const desc = await generateRouteDescription(route);
    el.rDesc.textContent = desc;
  } catch (e) {
    el.rDesc.textContent = '步行约 ' + Math.round(route.distance / 70) +
      ' 分钟，沿道路前行即可到达。';
  }

  // 相机动画：飞到路径上方
  flyToRoute(route);
}

async function handleAINavigate(el) {
  const text = el.aiInput.value.trim();
  if (!text) return;

  el.aiGo.disabled = true;
  el.aiGo.textContent = 'AI 思考中…';

  try {
    const result = await parseNaturalLanguage(text);
    if (result.error) {
      alert(result.error);
      return;
    }

    const from = findBuilding(result.from);
    const to = findBuilding(result.to);

    if (!from) { alert('找不到起点：' + result.from); return; }
    if (!to) { alert('找不到终点：' + result.to); return; }

    const route = await computeRoute(result.from, result.to);
    if (!route) { alert('无法规划路线'); return; }

    currentRoute = route;
    routeRenderer.showRoute(route);

    // 显示结果
    el.rFrom.textContent = from.name;
    el.rTo.textContent = to.name;
    el.rDist.textContent = Math.round(route.distance) + ' 米';
    el.rTime.textContent = '约 ' + Math.round(route.distance / 70) + ' 分钟';
    el.result.classList.remove('hidden');

    // 生成 AI 描述
    el.rDesc.textContent = '正在生成路线指引…';
    try {
      const desc = await generateRouteDescription(route);
      el.rDesc.textContent = desc;
    } catch (e) {
      el.rDesc.textContent = '步行约 ' + Math.round(route.distance / 70) +
        ' 分钟，沿道路前行即可到达。';
    }

    // 相机动画
    flyToRoute(route);

    // 切回经典模式并填充输入框
    document.querySelector('.nav-tab[data-mode="classic"]').click();
    el.from.value = from.name;
    el.to.value = to.name;

  } finally {
    el.aiGo.disabled = false;
    el.aiGo.textContent = 'AI 帮我找路';
  }
}

function flyToRoute(route) {
  // 计算路径中心点
  let cx = 0, cz = 0;
  route.points.forEach(p => { cx += p.x; cz += p.z; });
  cx /= route.points.length;
  cz /= route.points.length;

  // 相机位置：路径上方，俯视角度
  const dist = Math.max(300, route.distance * 0.6);
  const camPos = new THREE.Vector3(cx, dist * 0.7, cz + dist * 0.5);
  const tgtPos = new THREE.Vector3(cx, 0, cz);

  if (navTween) navTween = null;
  navTween = {
    p0: camera.position.clone(),
    p1: camPos,
    t0: controls.target.clone(),
    t1: tgtPos,
    f0: camera.fov,
    f1: fovFromLens(36, innerWidth / innerHeight),
    t: 0,
  };
}
