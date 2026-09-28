import { resolveLocationEdge } from '../domain/safety/capacity.js'

/**
 * 安全模式演示数据
 * ---------------------------------------------------------------------------
 * ★ 抽成独立文件而不是放在组件里，是为了避免
 *   `app/useSafetyState.js` ←→ `features/safety/SafetyModePanel.jsx` 的循环依赖。
 *
 * 天气场景采用 **W3 方案**：预置快照 + 面板一键切换。
 *   · 不需要 API Key（历史上泄露过一把，且前端直连会把 Key 暴露）
 *   · 不需要后端服务（演示现场网络不可控，静态快照永不失败）
 *   · 气象预警本身是小时级的，校园风控对分钟级延迟不敏感
 *   L1 实时接口（服务端代理）已预留：把 `WEATHER_SCENARIOS` 换成 fetch 结果即可，
 *   下游 `useSafetyState` 与所有组件都不用改。
 */
export const WEATHER_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'clear', label: '晴好', icon: '☀️', kind: 'clear', level: 'blue', text: '无气象预警，路网与场所维持常态', isDemo: true }),
  Object.freeze({ id: 'rainstorm_red', label: '暴雨红警', icon: '🌧️', kind: 'rainstorm', level: 'red', text: '未来 3 小时降雨量将达 100 毫米以上，低洼路段积水风险高', isDemo: true }),
  Object.freeze({ id: 'hail_orange', label: '冰雹橙警', icon: '🧊', kind: 'hail', level: 'orange', text: '将出现冰雹天气，露天场地存在直接人身伤害风险', isDemo: true }),
  Object.freeze({ id: 'heat_orange', label: '高温橙警', icon: '🌡️', kind: 'heat', level: 'orange', text: '最高气温将达 38°C，户外课程与训练存在中暑风险', isDemo: true }),
  Object.freeze({ id: 'gale_yellow', label: '大风黄警', icon: '🌬️', kind: 'gale', level: 'yellow', text: '阵风 8 级，行道树与临时围挡存在倒伏风险', isDemo: true }),
])

/**
 * 演示用上报 —— 用来展示「可信度闸门」与「分级矩阵」
 *
 * ★ 为什么需要它：线上真实事件结构里**没有** `ai.credibility` 字段
 *   （见 `src/data/events.js`），所以可信度闸门与证据链在真实数据下无从演示。
 *   这三条是刻意构造的演示数据，UI 上明确标注「演示数据」，不伪装成真实上报。
 *
 * 三条覆盖三种典型走向：
 *   · safety 55%  → 低于安全类阈值 0.75 → 进人工审核队列、灰标不打点
 *   · traffic 86% → 高于默认阈值 0.65   → 自动发布并联动封路
 *   · service 72% → 略高于阈值          → 自动发布但不封路
 */
export const DEMO_REPORTS = Object.freeze([
  Object.freeze({
    id: 'demo-safety-railing',
    type: 'safety',
    title: '湖畔挑台护栏松动',
    locationId: 'valley',
    text: '湖边挑台的护栏有松动，靠水一侧晃得厉害',
    ts: '2026-09-28T11:28:00+08:00',
    isDemo: true,
    ai: {
      credibility: {
        score: 0.55, threshold: 0.75, passed: false,
        breakdown: [
          { key: 'base', label: '基础分', value: 0.4, detail: '上报事件的最低可信度起点' },
          { key: 'source', label: '位置来源', value: 0.05, detail: '地图点选上报（manual）：−0.05 防乱标' },
          { key: 'crowd', label: '群体佐证', value: 0, detail: '仅 1 人独立上报，无群体佐证加分' },
          { key: 'commonSense', label: '常识一致性', value: 0.05, detail: '地点「智谷谷底」真实存在，通过存在性校验' },
          { key: 'text', label: '文本质量', value: 0.05, detail: '含具体位置与现象，具体程度一般' },
        ],
      },
    },
  }),
  Object.freeze({
    id: 'demo-traffic-truck',
    type: 'traffic',
    title: '食堂门口卡车占用车道',
    locationId: 'canteen',
    text: '食堂门口停了辆卡车卸货，一半车道过不去了',
    ts: '2026-09-28T11:28:00+08:00',
    affectedEdgeIds: Object.freeze([resolveLocationEdge('canteen')]),
    isDemo: true,
    ai: {
      credibility: {
        score: 0.86, threshold: 0.65, passed: true,
        breakdown: [
          { key: 'base', label: '基础分', value: 0.4, detail: '上报事件的最低可信度起点' },
          { key: 'source', label: '位置来源', value: 0.08, detail: '信标定位：物理在场，最强信号 +0.08' },
          { key: 'crowd', label: '群体佐证', value: 0.18, detail: '4 人独立上报，同簇时间差 < 10 分钟' },
          { key: 'commonSense', label: '常识一致性', value: 0.05, detail: '路段真实存在且当前可通行' },
          { key: 'text', label: '文本质量', value: 0.15, detail: '含车辆状态与通行影响，具体程度高' },
        ],
      },
    },
  }),
  Object.freeze({
    id: 'demo-service-parcel',
    type: 'service',
    title: '快递驿站取件排队较长',
    locationId: 'commercial-street',
    text: '商业街快递驿站排队有点长，取件要等一会儿',
    ts: '2026-09-28T11:30:00+08:00',
    isDemo: true,
    ai: {
      credibility: {
        score: 0.72, threshold: 0.65, passed: true,
        breakdown: [
          { key: 'base', label: '基础分', value: 0.4, detail: '上报事件的最低可信度起点' },
          { key: 'source', label: '位置来源', value: 0.05, detail: '地图点选上报（manual）' },
          { key: 'crowd', label: '群体佐证', value: 0.08, detail: '2 人独立上报，弱群体佐证' },
          { key: 'commonSense', label: '常识一致性', value: 0.05, detail: '地点真实存在且为服务类场所' },
          { key: 'text', label: '文本质量', value: 0.14, detail: '含现象与影响，具体程度中等偏上' },
        ],
      },
    },
  }),
])
