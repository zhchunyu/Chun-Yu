# OurCampus · 校园地图与社区

以手机校园地图为入口，连接地点、导航、大厅、账号、餐厅窗口和课表。前端使用 React + Vite，安卓使用 Capacitor，账号与大厅聊天使用 Supabase；AI 通过服务端网关调用 AUV。

本目录位于共享仓库的 `apps/ourcampus`。本目录安卓源码配置为 **1.11（versionCode 12）**，下列功能记录截至 2026-10-08。团队另行提供的 [1.17 体验包](../../docs/download.md)已独立发布；该二进制尚未与本目录源码建立可复现对应关系。

## 快速运行

环境：Node.js **22.12 或以上**、npm。已有仓库的同学先拉取最新代码；首次使用：

```powershell
git clone https://github.com/zhchunyu/Chun-Yu.git
cd Chun-Yu/apps/ourcampus
Copy-Item .env.example .env.local
npm ci
npm run dev -- --host 0.0.0.0
```

启动前向项目负责人索取开发配置，填入 `.env.local`：腾讯地图 Key、Supabase 根地址及 Publishable key。Supabase 根地址不带 `/rest/v1/`。需要本机 AI 网关时，另外填写 `AUV_BASE_URL` 和 `AUV_API_KEY`。字段见 [.env.example](.env.example)，真实配置不在仓库中。

打开终端显示的地址。手机浏览器预览需要与电脑在同一网络，使用电脑局域网 IP；`127.0.0.1` 只指当前设备。公开部署与 APK 使用的服务地址应能从手机访问。

```powershell
npm run build         # 网页生产构建，输出 dist/
npm run ai:serve      # 可选：独立 Node AI 网关，默认本机 8787
npm run android:apk   # 构建网页、同步 Capacitor 并生成 debug APK
npm run android:share # 通过本机网络分享已生成的 APK
```

## 当前功能与数据范围

| 功能 | 当前实现 |
| --- | --- |
| 校园地图与导航 | 腾讯 2D 地图、默认 17 级、缩放范围 14–20 级、地点搜索和详情、按需 GPS 定位、校园道路规划及手机腾讯地图导航入口。地点显示使用统一名称，原名可搜索；标签多数坐标仍由旧校园示意图换算，未完成逐建筑校准。 |
| 账号 | Supabase 邮箱注册、密码登录、数字验证码确认、密码重置、修改昵称、会话恢复；实际邮件投递依赖服务器 SMTP 和模板配置。 |
| 大厅聊天 | Supabase 消息存储和 Realtime 订阅、按地区筛选、历史分页、撤回本人消息、重连同步及轮询补偿；需服务器 RLS、消息表和实时广播配置正确。 |
| 餐厅评价 | 谷园一层六个真实窗口及菜单参考；管理员维护窗口，按窗口评分、推荐 / 吐槽筛选。云端评价需队友部署 11、12 号 SQL；部署前可保存本机评价，不混入真实统计。 |
| 热点、失物、校园消息 | 主动上报、异步 AI 分析、候选关联、管理员审核、全员 / 订阅通知、持久未读消息。队友需部署 09、10 号 SQL 与工作函数；历史本机信息不自动上传。 |
| 地点反馈、报修、收藏 | 地点反馈可选上云；报修完整工单仍为本机原型，收藏、常用路线和附近设施继续本机保存。 |
| 安卓系统推送 | 已接个推 SDK、权限同意、CID 绑定和通知点击；当前无 AppID，默认停用。真实后台推送需平台配置、重新打包及对应厂商离线通道。 |
| 课表 | 支持现有教务导出的 `.xls` 格式、本机解析、按账号保存与教学周设置；尚未直接接入教务账号或同步教务系统。 |
| AUV 校园助手 | 用户主动发送内容，经鉴权网关调用模型；可携带主动选择的地点与课表上下文。模型服务可用性由服务部署决定，未自动读取全部大厅消息或后台 GPS。 |
| 启动与手机适配 | 1.11 使用队友提供的约 5 秒品牌视频，静音、保持比例播放，同时加载应用；播放失败回退到静态新图标。桌面图标为深蓝底白色 C 与蓝色圆点，提供圆形、自适应及主题单色图层。顶部黑边修复仍需实际手机安装确认。 |

真实账号角色由服务器读取，前端不能自行提升为管理员。室内导航尚缺可靠楼层图，不作为已完成能力。历史方案中的演示角色、旧地图和旧接口描述，以当前代码及上述范围为准。

## 安卓安装与构建

体验最新团队安装包，请使用 [OurCampus 1.17 Release](https://github.com/zhchunyu/Chun-Yu/releases/tag/v1.17)，并阅读[安装说明与包名差异](../../docs/download.md)。

[OurCampus 1.11 安装包](docs/apk/OurCampus-1.11-队友图标与开屏.apk)保留历史归档，使用 debug 签名；下列自行构建步骤对应本目录现有源码。

自行构建需要 **JDK 21、Android SDK API 36**（当前 Build Tools 35.0.0）及 Gradle 依赖。优先复用已有环境。设置 `JAVA_HOME`，并在不提交的 `android/local.properties` 中填写本机 `sdk.dir`。运行 `npm run android:apk` 后，产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

保留当前 applicationId，升级时递增版本号。不要把服务器密钥改成 `VITE_` 字段；所有 `VITE_` 配置会进入网页和 APK。首页定位仅由用户点击触发，无后台持续定位。

用户提供的图标原稿位于 `public/assets/brand/ourcampus-teammate-icon-1024.png`，开屏视频位于同目录的 `ourcampus-startup.mp4`。需要重新生成图标尺寸时运行 `scripts/generate-launcher-icons.py`，使用已有 Python/Pillow；可通过 `--source` 指定其他正方形 PNG。转换时保留原图内容，为 Android 自适应图标留出中央安全区。

## 代码入口

```text
src/App.jsx                  页面与功能组装
src/app/                     应用状态、启动动画
src/data/                    地点、道路、存储、Supabase 和 AI 调用
src/domain/                  搜索、路线及反馈规则
src/features/account/        真实登录会话
src/features/mobile/         手机界面、大厅、社区与个人页
src/features/reviews/        餐厅窗口与评价
src/features/timetable/      课表界面
src/features/ai/             AUV 助手界面
server/                      Node AI 网关适配
supabase/functions/          AI Edge Function 和共用业务处理
android/                     Capacitor 安卓工程
docs/supabase/               建表、种子、邮件模板与服务器交接说明
public/assets/               地图素材与保留模型
output/pdf/                  技术方案书源文档与导出 PDF
```

## 队友协作

请先看 [团队协作说明](docs/团队协作.md)，其中列出了前端、服务器和 AI 的修改入口、私密配置的交接方法和上线检查项。

- [真实账号与聊天配置](docs/supabase/真实账号与聊天联调.md)
- [餐厅窗口管理员配置](docs/supabase/餐厅窗口管理-给队友.md)
- [邮件数字验证码模板](docs/supabase/email-templates/邮件数字验证码设置.md)
- [AUV 对接说明](docs/auv-integration-2026-10-05.md)
- [课表导入说明](docs/timetable-import-2026-10-05.md)
- [校园信息、系统推送与真实餐厅评价交接](docs/校园信息推送交接-2026-10-08/README-先看这里.md)

源码、SQL、安卓工程、可编辑文档及当前 APK 一起共享；依赖缓存、构建缓存、真实密钥、个人截图和旧版压缩包不纳入仓库。部分保留资料不是当前界面的默认资产。

