# CampusTwin · 校园数字孪生

CampusTwin 是一个以校园地图为主界面的数字孪生演示版。当前重点是让地点、路线、校园热点和管理者操作在同一张地图上联动；地图资产由共享仓库提供。

## 快速运行

环境要求：Node.js `^20.19.0` 或 `>=22.12.0`，npm。

```bash
npm ci
npm run dev
```

Vite 启动后，打开终端显示的本地地址。常用命令：

```bash
npm test       # 运行 Vitest 测试
npm run build  # 构建生产文件到 dist/
```

## 当前功能

- 3D 校园地图为主视角，可切换 2D 总平面图。
- 搜索校园地点，按类别筛选，查看地点状态和校园热点。
- 使用校园道路图规划五种步行路线：最短、无障碍、避开施工、避雨和夜间安全。
- 模拟当前位置、第一人称视角和地图图层控制。
- 访客、学生、管理者演示角色；管理者可修改地点状态并发布、结束热点。
- 浏览器本地保存部分设置、角色和演示数据。

## 当前演示边界

- 当前 3D 模型和 2D 底图使用 `public/assets/campus.glb` 与 `public/assets/shanhe-campus-plan.svg`，来源版本记录在 `src/data/campusMap.js`。
- 数据使用本地演示数据；角色切换用于演示权限，不是账号认证。
- `src/data/httpCampusDataSource.js` 是预留的 HTTP 数据适配器，目前应用启动仍使用本地数据源，尚无后端服务。
- 管理者修改只保存在当前浏览器的本地存储中，不会同步给其他设备。
- `public/assets/` 内其他校园模型和图片是保留的本地资料，当前地图配置没有加载它们。

## 代码结构

```text
src/
├── app/        应用状态与状态更新
├── data/       校园地点、地图资产、道路图、本地存储和数据源
├── domain/     搜索、路线、相机和地图坐标规则
├── features/   地图、地点、路线、热点和角色界面
├── components/ 通用展示模块
└── styles.css

public/assets/  校园模型、平面图及保留的地图资料
docs/           产品方案与分阶段实施计划
```

## 开发约定

- 先检查 `docs/superpowers/specs/` 中的产品方案和 `docs/superpowers/plans/` 中的实施计划。
- 地点、事件和路线通过稳定的 ID 关联；新增地图相关能力时优先复用现有数据结构。
- `node_modules/`、`dist/`、`_incoming/` 和 `.superpowers/` 属于依赖、构建产物或临时工作文件，不纳入版本管理。
- 完成代码改动后，按改动范围运行测试或构建，并在提交信息中说明变化。
