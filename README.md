<div align="center">

<img src="docs/assets/ourcampus-icon.png" alt="OurCampus 图标" width="96" height="96">

# OurCampus

**从找到一个地点，到一起解决校园里的小事。**

校园地图、同学社区与 AUV 校园助手，在同一个入口。

[快速开始](docs/quickstart.md) · [项目文档](docs/README.md) · [Android 1.11 体验包](apps/ourcampus/docs/apk/OurCampus-1.11-队友图标与开屏.apk) · [问题反馈](https://github.com/zhchunyu/Chun-Yu/issues) · [开发状态](docs/status.md)

`React` · `Vite` · `Capacitor` · `Supabase`

<img src="docs/assets/map-preview.png" alt="OurCampus 校园地图界面：地点搜索、地图标记、按需定位和社区入口" width="340">

归档版本的二维地图界面示例

</div>

## 什么是 OurCampus

OurCampus 是我们团队开发的校园地图与社区应用。地点、交流和助手围绕真实校园生活连接起来：找到餐厅窗口、查看地点相关动态、发布失物线索，或带着当前地点向 AUV 提问。

项目提供 Web 前端源码和 Android 协作体验包，当前处于开发与联调阶段。

| 校园地图 | 同学社区 | AUV 校园助手 |
| --- | --- | --- |
| 搜索地点、查看详情和餐厅窗口，保存收藏与常用路线，按需定位并预览路线。 | 按校园地区交流，主动上报热点、失物与地点反馈，围绕餐厅窗口评分与讨论。 | 登录后提问，主动选择地点与课表上下文，由服务端网关调用模型。 |

## 开始体验

**Android：**下载 [OurCampus 1.11](apps/ourcampus/docs/apk/OurCampus-1.11-队友图标与开屏.apk)。当前安装包使用 debug 签名，供团队安装体验与反馈。

**本地开发：**需要 Node.js 22.12 或以上版本和 npm。

```powershell
git clone https://github.com/zhchunyu/Chun-Yu.git
cd Chun-Yu/apps/ourcampus
Copy-Item .env.example .env.local
npm ci
npm run dev
```

启动前填写 `.env.local` 中的腾讯地图 Key、Supabase 地址与 Publishable key；字段见 [.env.example](apps/ourcampus/.env.example)。AUV 模型密钥只保存在服务端。完整配置与运行步骤见[快速开始](docs/quickstart.md)。

## 开发进展

当前已形成地图、账号、社区与 AUV 助手入口。团队正在完成多人协作、模型调用和消息送达的联调，并持续校准地图与校园道路。具体接入范围、版本记录和待验证项目见[开发状态](docs/status.md)。

## 仓库导航

```text
apps/
  ourcampus/       Web 页面、Android 工程与服务端适配
models/
  auv/             模型、训练、推理与评测资料
docs/              快速开始、架构、部署与开发状态
archive/           历史方案、研究素材与归档交付
```

| 想做什么 | 从这里开始 |
| --- | --- |
| 运行应用或构建 Android | [快速开始](docs/quickstart.md) · [应用工程](apps/ourcampus/) |
| 理解模块与数据流程 | [系统架构](docs/architecture.md) |
| 配置 Supabase 与 AUV 网关 | [部署说明](docs/deployment.md) |
| 查看模型与评测资料 | [AUV 工程](models/auv/) |
| 参与开发或交接模块 | [团队协作](apps/ourcampus/docs/团队协作.md) |
| 查阅历史方案与归档文件 | [资料归档](archive/) |

## 参与协作

欢迎通过 [Issues](https://github.com/zhchunyu/Chun-Yu/issues) 反馈问题或建议。反馈时请附上设备、使用入口、复现步骤和截图，便于对应地图、社区、账号或助手模块排查。

提交前请确认没有包含真实密钥、个人信息或本机配置。应用测试与构建命令、模块负责范围见[应用说明](apps/ourcampus/README.md)和[团队协作](apps/ourcampus/docs/团队协作.md)。

## 接下来

- 校准校园地点与道路，补充信息来源、更新时间和审核反馈。
- 完成真实账号、多人协作、AUV 调用与消息送达的联调验收。
- 继续打磨 Web 与 Android 的日常使用体验。

<details>
<summary>后续研究：三维浏览与室内导航</summary>

三维素材与历史原型保留在归档区，供后续研究使用。三维浏览将在二维服务稳定后推进；室内导航仍需可靠楼层图与通道数据。

</details>

<sub>状态核对：2026-10-17。功能说明随代码与联调结果更新。</sub>
