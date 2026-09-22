# 春雨工作区

> 面向 C 端的未来校园社区软件 —— 第八届全球校园人工智能算法精英大赛 · AI+软件创新赛道（赛题 2）

---

## 一、项目一句话定位

用 AI 把「校园」重建成一个可交互、可共创、可生长的数字社区，让 C 端学生用户在其中社交、学习、生活、创作。

---

## 二、赛事关键约束（速查）

| 项目 | 要求 |
| --- | --- |
| 赛道 | AI+软件创新（算法创新赛 · 赛题 2） |
| 团队 | ≤3 人，须为本校在读学生；指导教师 ≤2 名 |
| 组别 | 青创学生组 / 产教融合组 |
| 报名 | 大赛官网 www.aicomp.cn，队长统一操作 |
| 校赛 | 2026-10-10 前完成 |
| 省赛/区域赛 | 报名截止 2026-10-15 20:00，比赛最迟 11-01 前完成 |
| 总决赛 | 2026 年 11 月中下旬 |

**提交物清单**

1. 作品名称（≤20 字）
2. 作品简介（≤300 字，问题-方案-效果-应用）
3. 作品方案 / 技术方案（PDF，≤10MB）
4. 演示视频（MP4，3-5 分钟，≤300MB）
5. 答辩 PPT（PDF）
6. 佐证材料（PDF 合并为一个文件）
7. 作品其他材料链接（百度网盘，永久有效）

**评分权重**：创新性 20 / 技术实现 20 / 功能完整性 20 / 方案完整性 20 / 应用价值 15 / 总结展望 5

> ⚠️ **红线**：作品材料（方案、视频、PPT）中**不得出现学校名称及 Logo、指导教师等信息**，否则扣分或取消资格。

赛事原文见 `00-赛事与规范/`。

---

## 三、目录导航

| 目录 | 用途 | 负责内容 |
| --- | --- | --- |
| `00-赛事与规范/` | 赛事原始资料、官方模板、提交规范 | 赛制解读、合规检查 |
| `01-产品设计/` | 需求调研 → 功能架构 → 原型 → UI | 产品定义与体验设计 |
| `02-三维资产/` | **CAD 建模 + Blender 场景资产生产线** | 校园数字孪生资产 |
| `03-算法工程/` | 数据、训练、推理服务、评测 | AI 能力内核 |
| `04-应用开发/` | 前端 / 后端 / 共享层 | C 端产品实现 |
| `05-测试与质量/` | 测试用例、测试报告 | 功能完整性佐证 |
| `06-竞赛材料/` | 7 项提交物的成稿 | 参赛交付 |
| `07-项目文档/` | 会议记录、技术文档、参考资料 | 过程沉淀 |
| `08-交付与归档/` | 最终交付、历史版本 | 版本管理 |
| `99-临时工作区/` | 草稿、试验、废弃内容 | 不进入交付 |

---

## 四、三维资产生产线（核心工作流）

本项目采用 **「文本 → CAD → Blender → 应用」** 的四段式资产管线：

```
自然语言描述
    │
    ▼
[ text-to-cad / cad skill ]      参数化建模，输出 STEP / DXF
    │
    ▼
[ cad-viewer skill ]             本地浏览器实时预览与校核
    │
    ▼
[ Blender + mcp-for-blender ]    实时场景搭建、材质、灯光、渲染
    │
    ▼
[ export-pipeline skill ]        导出 GLB / glTF 供前端消费
    │
    ▼
C 端应用（Web / 小程序 / 桌面）
```

**目录约定**

- `02-三维资产/cad/` —— 遵循 cadgen 工程规范：`src/` 放模型脚本，`STEP/` `DXF/` `STL/` `GLB/` `3MF/` 放产物，`checks/` 放校验脚本，`tmp/` 放临时探索。模型目录见 `cad/src/README.md`。
- `02-三维资产/blender/projects/` —— `.blend` 工程文件
- `02-三维资产/blender/addons/` —— Blender 插件（含 `blender_mcp.py`）
- `02-三维资产/exports/` —— 交付给前端的最终资产
- `02-三维资产/renders/` —— 渲染出图（用于方案书与 PPT）

---

## 五、环境配置状态

### 已安装的 Skills（用户级 `~/.workbuddy-ai/skills/`，共 27 个）

**text-to-cad 库**（来源：`earthtojake/text-to-cad`，MIT）

| Skill | 作用 |
| --- | --- |
| `cad` | 文本/图像 → 参数化 CAD，导出 STEP / STL / 3MF / GLB |
| `cad-viewer` | 本地浏览器实时预览 CAD 与机器人文件 |
| `dxf` | 生成 2D 工程图（轮廓、模板、垫片、排版） |
| `step-parts` | 检索现成标准件 STEP（螺丝、轴承、电机、连接器） |

**Blender 配套库**（来源：`arjun988/blender-skills`，MIT）

- 编排：`blender-director`、`references`
- 建模：`blender-modeler`、`environment-artist`、`prop-artist`、`archviz`、`vegetation-artist`、`hard-surface`
- 风格：`lowpoly-style`、`stylized-style`、`realistic-style`
- 生产：`materials`、`lighting`、`uv-workflow`、`texture-workflow`
- 技术：`geometry-nodes`、`procedural-modeling`、`camera-cinematography`、`rendering`
- 管线：`scene-assembly`、`asset-optimization`、`export-pipeline`、`qa-review`

> 上游 `blender-skills` 共 94 个 skill，此处按「校园资产生产」需求精选 23 个核心 skill 安装。
> 其余（角色、恐怖风格、游戏品类、毛发/布料/绑定等）暂存在
> `~/.workbuddy-ai/cache/skill-src/bs/blender-skills-main/.claude/skills/`，需要时可随时补充安装。

### MCP 配置

- 配置文件：`~/.workbuddy-ai/mcp.json`
- 服务：`blender` → `uvx mcp-for-blender`（PyPI 包 `mcp-for-blender`，即原 `blender-mcp`）
- `uv` / `uvx`：`C:\Users\31967\.local\bin\uv.exe`（v0.12.17）
- Python 运行时：uv 托管的 CPython 3.11.15
- 连接参数：`localhost:9876`；遥测默认关闭（如需开启，删除 `DISABLE_TELEMETRY`）

**启用方式**：连接器管理页右上角「自定义连接器」入口 → 找到 `blender` → 点击「信任」。

### Blender 环境

| 项目 | 值 |
| --- | --- |
| 版本 | **Blender 5.2.2（Microsoft Store / MSIX 版）** |
| 启动方式 | 桌面快捷方式 `Blender 5.2.2.0.lnk` 或开始菜单 |
| 程序路径 | `C:\Program Files\WindowsApps\BlenderFoundation.Blender_5.2.2.0_x64__ppwjx1n5r4v9t\Blender\blender.exe` |
| 插件目录（虚拟化） | `%LOCALAPPDATA%\Packages\BlenderFoundation.Blender_ppwjx1n5r4v9t\LocalCache\Roaming\Blender Foundation\Blender\5.2\scripts\addons\` |
| 已安装插件 | `blender_mcp.py`（MCP for Blender v1.7，**已就位**） |

> Store 版 Blender 的 `%APPDATA%` 被 MSIX 重定向到 `LocalCache\Roaming`，因此插件必须放在上面的虚拟化路径，普通 `%APPDATA%\Blender Foundation\` 下不会生效。

**备用环境**：`C:\Users\31967\Blender\blender-4.5.9-windows-x64\`（便携版 Blender 4.5.9 LTS）。
若 Store 版 5.2 与插件存在兼容问题，可直接用这个版本，双击其中的 `blender.exe` 即可运行。

---

## 六、交付与发布

### 在线访问（公网）

**https://2cb735b0c4814c359bab62cc039d9c7a.sg2.agentos-app.run**

静态站点，内容 = `02-三维资产/site/`（由 `tools/make_site.py` 生成，约 17 MB）：

| 页面 | 内容 |
| --- | --- |
| `/` | 入口页（链接中枢 + 成果指标） |
| `/preview.html` | **全园 3D 预览**（three.js + GLB，112 万面，7 个机位预设） |
| `/建模图集/山河大学_三维建模图集.html` | 三维建模图集（五章，A4 横向可打印成 PDF） |
| `/建模图集/…_手机版.html` | 图集单文件版（图片内嵌，可离线） |
| `/renders/总览_R0-R6.html` | 分阶段改动对照 + A/B 量化 |

> ★ 同一目录**重新发布链接不变**，更新内容不必换链接。
> ★ 站点用**中文文件名的百分号编码相对路径**引用图片 —— 已实测线上 24/24、81/81 图片正常加载。

### 代码仓库

**https://github.com/zhchunyu/Chun-Yu**（**私有**）｜ 交付分支 **`main`**

| 内容 | 位置 |
| --- | --- |
| 全部源文件（711 个 / 533 MB） | 仓库树 |
| Blender 工程文件（24 个 / 1112 MB） | **Release** `blend-projects`（见下） |

> ★ **`.blend` 为什么走 Release 而不是仓库树**：GitHub API 的 blob 端点有**单请求体积**限制
> （实测 34 MB 通过 / 40 MB 起 `422 too large`，与"单文件 100 MB"的名义上限无关）。
> 24 个 `.blend` 里 16 个过不去 ⇒ 改以 Release 资产分发（走 `uploads.github.com`，
> 原始字节直传，单资产上限 2 GB）。
> 下载页：`https://github.com/zhchunyu/Chun-Yu/releases/tag/blend-projects`

> ★ **本机 `git push` 走不通**：代理按域名拦截，`github.com` 返回 `CONNECT 502`，
> 但 `api.github.com` 可达 ⇒ 推送改走 **Git Data API**（`tools/push_via_api.py`，
> blobs → tree → commit → ref，含 blob 缓存续传与 SHA 校验）。

---

## 七、待办（人工步骤）

- [x] 安装 Blender（已有 Store 版 5.2.2）
- [x] 安装 MCP 插件到 Blender 插件目录
- [ ] **在 Blender 中启用插件**：`Edit → Preferences → Add-ons` → 搜索 `MCP for Blender` → 勾选启用
- [ ] **启动服务**：3D 视口按 `N` → **MCP for Blender** 标签 → 点击 **Start MCP Server**
- [ ] 连接器管理页「信任」`blender` 服务
- [x] 在 `01-产品设计/` 中补齐需求与用户画像
- [ ] 确定技术栈并初始化 `04-应用开发/`
- [ ] `06-竞赛材料/`：作品简介 / 方案书 PDF / 演示视频 / 答辩 PPT / 佐证材料 / 网盘链接
      （★ 建模层面的取图入口见 `06-竞赛材料/README.md` 与 `02-三维资产/建模图集/选图清单.md`）

> ★ **无头渲染用便携版** `C:\Users\31967\Blender\blender-4.5.9-windows-x64\blender.exe` ——
> Store（MSIX）版**无法从命令行调用**，只适合手动开界面。

---

*最后更新：2026-09-22*
