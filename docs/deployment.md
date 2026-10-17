# 部署说明

OurCampus 的 Web 与 Android 使用同一应用工程。静态页面托管、Supabase 业务服务和 AUV 模型服务分别配置；源码重组后，应用根目录统一为 `apps/ourcampus`。

## Web 构建与托管

| 设置 | 值 |
| --- | --- |
| 应用根目录 | `apps/ourcampus` |
| Node.js | 22.12 或以上 |
| 依赖安装 | `npm ci` |
| 构建命令 | `npm run build:pages` |
| 发布目录 | 应用根目录下的 `dist`，即仓库中的 `apps/ourcampus/dist` |

`build:pages` 先运行 Vite 构建，再排除当前二维应用没有使用的历史大型三维模型。日常通用构建仍可使用 `npm run build`。

在静态托管服务的构建环境中配置：

```text
VITE_TENCENT_MAP_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_AUV_GATEWAY_URL
```

前三项用于地图和账号业务。`VITE_AUV_GATEWAY_URL` 为可选项，留空时前端请求当前 Supabase 的 `/functions/v1/auv-assistant`；指定时应填写完整 HTTPS 网关地址。

这些字段在构建时写入前端，修改后需要重新构建。腾讯地图 Key 的域名设置应覆盖实际访问入口。发布到子路径时，应同步核对 Vite 的资源基路径与托管服务的访问路径。

静态托管不运行 Vite 开发中间件或 Node AI 网关。线上 AI 请求使用已配置的云端入口。

## Supabase 配置

当前应用沿用已有 Supabase 项目。目录重组只改变源码路径；已有生产数据库、账号和业务数据继续由原项目维护。

| 配置内容 | 工程位置 |
| --- | --- |
| 账号、聊天、窗口等 SQL 与交接说明 | [`apps/ourcampus/docs/supabase`](../apps/ourcampus/docs/supabase/) |
| Edge Functions | [`apps/ourcampus/supabase/functions`](../apps/ourcampus/supabase/functions/) |
| 函数鉴权配置 | [`apps/ourcampus/supabase/config.toml`](../apps/ourcampus/supabase/config.toml) |
| 校园信息与推送增量交接 | [后台交接入口](../apps/ourcampus/docs/校园信息推送交接-2026-10-08/README-先看这里.md) |

已有服务侧记录包含 `auv-assistant` 和 `campus-information-worker` 的部署，以及校园信息与餐厅评价相关数据表。接手时先核对现有表、函数版本、权限与调度，再按缺失项处理。

旧交接文档包含基础建库与增量 SQL。已有数据库先执行交接包中的只读前置检查，确认实际状态；不要因为目录变更重跑基础建库、种子或已经执行的增量脚本。

### 账号、数据与邮件

账号与聊天依赖 Supabase Auth、业务表、RLS 和 Realtime 配置。邮箱验证码、重置密码与邮件投递还需要对应 SMTP 和模板设置。客户端角色以服务器读取结果为准。

配置方法见[真实账号与聊天联调](../apps/ourcampus/docs/supabase/真实账号与聊天联调.md)和[邮件数字验证码设置](../apps/ourcampus/docs/supabase/email-templates/邮件数字验证码设置.md)。

### AUV 助手

服务端通过 Secrets 读取：

```text
AUV_BASE_URL
AUV_API_KEY
```

`AUV_BASE_URL` 为模型服务根地址，不拼接 `/v1/chat/completions`。`auv-assistant` 的配置保留 `verify_jwt = true`，函数内部继续验证用户会话。

函数源码引用同级 `_shared` 目录。更新部署工程时，应同步完整共享目录，避免网关、校园地名和业务规则使用不同版本。模型密钥通过团队既有方式单独交接，不写入前端环境变量或文档。

### 校园信息工作函数

`campus-information-worker` 沿用配置中的 `verify_jwt = false`，函数内部验证独立的 `x-campus-worker-token`。其工作令牌、服务端参数与调度配置按[服务器交接材料](../apps/ourcampus/docs/校园信息推送交接-2026-10-08/README-先看这里.md)维护。

交接材料中的任务调度使用即时异步唤醒与定时补偿。现有调度是否启用、任务是否成功完成，应结合实际任务记录核对；不因函数已部署直接认定队列和消息送达已通过验收。

## 独立 Node 网关

如使用自有服务器托管 AI 网关，在 `apps/ourcampus` 运行：

```powershell
npm ci
npm run ai:serve
```

网关默认监听 `127.0.0.1:8787`，接口为 `/api/auv-assistant`。部署时使用 HTTPS 反向代理，并在前端 `VITE_AUV_GATEWAY_URL` 中填写外部可访问的完整 API 地址后重新构建。网关读取服务端 `.env.local` 中的模型配置与 Supabase 配置。

## Android 构建与交付

1. 使用[快速开始](quickstart.md)准备 Node.js、JDK 和 Android SDK。
2. 填写应用配置；手机使用的 API 地址需能从设备访问。
3. 在 `apps/ourcampus` 运行 `npm run android:apk`。
4. 从 `android/app/build/outputs/apk/debug/app-debug.apk` 获取 debug 产物并安装验证。

保留现有 applicationId，升级时递增版本号。仓库中现有体验包为 1.11 / versionCode 12；正式签名由负责人保管。

系统推送需要个推平台配置、公开 AppID、服务端凭据与手机通知权限；部分品牌的离线通知还需厂商通道。AppID 可交给客户端构建使用，AppKey 与 MasterSecret 留在服务端。完成配置后重新打包并进行真机验证。

## 部署后的验证

先确认地图资源加载、账号登录和业务请求，再使用真实账号检查 AUV 回复、双设备聊天、校园动态审核与消息送达。具体待验收项统一维护在[开发状态](status.md)。

[返回文档首页](README.md)
