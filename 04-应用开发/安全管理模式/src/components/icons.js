/**
 * 图标兼容层
 * ---------------------------------------------------------------------------
 * 为什么需要这一层：
 *  - 主仓库（CampusTwin）使用 `lucide-react` 图标库，组件必须与既有风格一致；
 *  - 但本模块需要**能在没有 node_modules 的环境里独立跑自检**（当前快照环境
 *    没有 package.json / node_modules）。
 *
 * 因此这里的做法是：优先使用 lucide 图标，取不到时退化为一个不依赖任何
 * 第三方库的轻量 SVG。这样同一份组件代码在两种环境下都能渲染，
 * 不需要为演示单独分叉一份代码。
 *
 * ★ 拷入主仓库后，`lucide-react` 必然可用，走的就是第一条路径；
 *   这个兼容层不会带来任何额外开销，也不会改变组件对外接口。
 */

/**
 * 创建图标组件。
 *
 * @param {string} lucideName 对应 `lucide-react` 的导出名（如 `ShieldAlert`）
 * @param {string} fallbackPath 取不到 lucide 时使用的 SVG path（24×24 视口）
 * @param {number} [defaultSize=16] 默认尺寸
 * @returns {Function} React 组件
 */
function createIcon(lucideName, fallbackPath, defaultSize = 16) {
  function Icon({ size = defaultSize, className, ...rest }) {
    const Lucide = resolveLucide(lucideName)
    if (Lucide) return jsx(Lucide, { size, className, ...rest })
    return jsx('svg', {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className,
      'aria-hidden': 'true',
      ...rest,
    }, jsx('path', { d: fallbackPath }))
  }
  Icon.displayName = `Icon(${lucideName})`
  return Icon
}

/**
 * 解析 React 与 lucide 的运行时依赖。
 * ★ 用函数内的动态取值，避免在模块顶层写 `import` —— 否则在没有这些
 *   依赖的环境里连模块都加载不了，自检直接失败。
 */
function resolveReact() {
  return globalThis.__SAFETY_REACT__ ?? null
}

function resolveLucide(name) {
  const lib = globalThis.__SAFETY_LUCIDE__ ?? null
  return lib?.[name] ?? null
}

/**
 * 注入 React 运行时。
 *
 * 主仓库里通常不需要调用（组件用顶层 `import` 引入 React 更自然），
 * 但独立自检环境需要显式注入。若未注入，`jsx()` 会退化为一个
 * **纯数据描述对象**，仍然可以断言结构，不会抛错。
 *
 * @param {object} react `react` 模块
 * @param {object} [lucide] `lucide-react` 模块
 */
export function installRuntime(react, lucide = null) {
  if (react) globalThis.__SAFETY_REACT__ = react
  if (lucide) globalThis.__SAFETY_LUCIDE__ = lucide
  return { react: Boolean(globalThis.__SAFETY_REACT__), lucide: Boolean(globalThis.__SAFETY_LUCIDE__) }
}

/**
 * 创建元素。
 *
 * - 有 React：走 `React.createElement`
 * - 无 React：返回 `{ $$typeof: 'dsh.mock.element', type, props, children }`
 *   这样的纯数据，便于在无构建环境下校验组件结构
 */
export function jsx(type, props = null, ...children) {
  const React = resolveReact()
  if (React?.createElement) {
    return React.createElement(type, props, ...children.flat().filter((child) => child != null && child !== false))
  }
  return {
    $$typeof: 'dsh.mock.element',
    type: typeof type === 'function' ? type.displayName ?? type.name ?? 'anonymous' : type,
    props,
    children: children.flat().filter((child) => child != null && child !== false),
  }
}

/** 片段（等价 React.Fragment） */
export function fragment(...children) {
  return jsx('fragment', null, ...children)
}

/** 类名字符串拼接（过滤假值） */
export function classNames(...values) {
  return values.flat().filter(Boolean).join(' ')
}

export const ShieldAlert = createIcon('ShieldAlert', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 8v4 M12 16h.01')
export const AlertTriangle = createIcon('AlertTriangle', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01')
export const Users = createIcon('Users', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75')
export const CloudRain = createIcon('CloudRain', 'M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25 M8 19v2 M12 19v2 M16 19v2')
export const CloudLightning = createIcon('CloudLightning', 'M19 16.9A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25 M13 11l-4 6h6l-4 6')
export const Thermometer = createIcon('Thermometer', 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z')
export const Wind = createIcon('Wind', 'M9.59 4.59A2 2 0 1 1 11 8H2 M12.59 19.41A2 2 0 1 0 14 16H2 M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2')
export const Route = createIcon('Route', 'M9 6h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6')
export const Megaphone = createIcon('Megaphone', 'M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z M15 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12')
export const UserCheck = createIcon('UserCheck', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M16 11l2 2 4-4')
export const DoorClosed = createIcon('DoorClosed', 'M4 2h16v20H4z M14 12h.01')
export const Footprints = createIcon('Footprints', 'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0z M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0z')
export const Camera = createIcon('Camera', 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z')
export const Clock = createIcon('Clock', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2')
export const CheckCircle = createIcon('CheckCircle', 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3')
export const XCircle = createIcon('XCircle', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M15 9l-6 6 M9 9l6 6')
export const Eye = createIcon('Eye', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')
export const Play = createIcon('Play', 'M5 3l14 9-14 9V3z')
export const RotateCcw = createIcon('RotateCcw', 'M1 4v6h6 M3.51 15a9 9 0 1 0 2.13-9.36L1 10')
export const ShieldCheck = createIcon('ShieldCheck', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4')
export const ListChecks = createIcon('ListChecks', 'M3 6h13 M3 12h13 M3 18h13 M18 6l2 2 3-3 M18 12l2 2 3-3')
export const Activity = createIcon('Activity', 'M22 12h-4l-3 9L9 3l-3 9H2')
export const TrendingUp = createIcon('TrendingUp', 'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6')
export const ChevronDown = createIcon('ChevronDown', 'M6 9l6 6 6-6')
export const ChevronRight = createIcon('ChevronRight', 'M9 18l6-6-6-6')
export const Info = createIcon('Info', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01')
export const Ban = createIcon('Ban', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M4.93 4.93l14.14 14.14')
export const Volume2 = createIcon('Volume2', 'M11 5 6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14 M15.54 8.46a5 5 0 0 1 0 7.07')
