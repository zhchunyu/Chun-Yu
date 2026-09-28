# campus-twin-patch · 整合补丁快照

> 快照日期：2026-09-28
> 对应源码：分支 `campustwin-afternoon` 上的提交 **`8685fd9`**（`feat(安全模式): 将安全管理模式整合进 CampusTwin 主页`）
> ★ **权威源码在分支里，不在本目录。** 本目录只是把「整合到 CampusTwin 的那几个文件」拷出来，方便评审离线查看与对照；
> 不要在这里改代码 —— 改了不会生效，下一次刷新快照就会被覆盖（`02-三维资产/site/` 与 `web-demo/` 的双份维护就是这么变脏的）。

## 怎么拿到可运行的完整工程

```bash
git clone -b campustwin-afternoon https://github.com/zhchunyu/Chun-Yu.git campustwin
cd campustwin
npm ci
npm run dev            # 打开 http://localhost:5173/?safety=1&scene=2d
npm test               # 16 个文件 / 108 项
npm run build          # 产物在 dist/
```

Windows 上也可以直接双击本目录的 `预览.cmd`（内容与分支根目录那份一致，会自动打开
`http://127.0.0.1:5173/?safety=1&scene=2d`）。

## 本目录内容

| 文件 | 行数 | 类型 |
| --- | --- | --- |
| `src/domain/safety/index.js` | 947 | 新增：人流风控、预警分级、状态机、六个预案 + 八个动作、SLA |
| `src/domain/safety/capacity.js` | 437 | 新增：容量口径、天气修正、地点 → 真实路段映射 |
| `src/domain/safety/safety.test.js` | 277 | 新增：33 项断言 |
| `src/app/useSafetyState.js` | 205 | 新增：安全态势 Hook（面板与叠加层共享） |
| `src/data/safetyDemo.js` | 88 | 新增：天气场景快照 + 三条演示上报 |
| `src/features/safety/SafetyModePanel.jsx` | 356 | 新增：安全面板（居中浮层、正文双列、内部滚动） |
| `src/features/safety/SafetyMapOverlay.jsx` | 168 | 新增：2D 叠加层（风险区 / 人流热力 / 封控路段） |
| `src/App.jsx` | 204 | 改动：接入态势 + `?safety=` 深链接 |
| `src/app/campusReducer.js` | 356 | 改动：安全模式不跨会话恢复，普通 URL 仍是干净默认视图 |
| `src/data/appSettings.js` | 35 | 改动：4 个布尔设置（`safetyMode` 默认 false） |
| `src/features/map/MapToolbar.jsx` | 89 | 改动：新增「安全管理」工具项，抽屉里不再挂面板 |
| `src/features/map/MapWorkspace.jsx` | 196 | 改动：挂载居中浮层 + 条件渲染叠加层 |
| `src/features/map/MapLayerPanel.jsx` | 44 | 改动：安全图层分组（条件显示） |
| `src/styles.css` | 552 | 改动：安全面板 / 叠加层样式（+204 行） |
| `预览.cmd` | 40 | 本地预览脚本 |

三张效果图：`整合效果截图.png`（居中面板）、`整合效果_地图叠加层.png`（收起面板后的风险叠加层）、
`整合效果_手机横屏.png`（844×390）。

整合的完整说明、缺陷清单与已知限制见上一级目录的 `CampusTwin整合说明.md`；
面板与状态机的设计取舍见分支内 `docs/superpowers/specs/2026-09-28-safety-mode-design.md`。
