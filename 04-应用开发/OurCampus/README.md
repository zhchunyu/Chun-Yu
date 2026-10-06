# OurCampus · 校园地图与社区

以手机校园地图为入口，连接地点、导航、大厅、账号、餐厅窗口和课表。前端使用 React + Vite，安卓使用 Capacitor，账号与大厅聊天使用 Supabase；AI 通过服务端网关调用 AUV。

本目录位于共享仓库的 `04-应用开发/OurCampus`。当前安卓版本为 **1.7（versionCode 8）**，更新记录截至 2026-10-06。

## 快速运行

环境：Node.js **22.12 或以上**、npm。已有仓库的同学先拉取最新代码；首次使用：

```powershell
git clone https://github.com/zhchunyu/Chun-Yu.git
cd Chun-Yu/04-应用开发/OurCampus
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
| 校园地图与导航 | 腾讯 2D 地图、默认 17 级、地点搜索和详情、按需 GPS 定位、校园道路规划及手机腾讯地图导航入口。比赛模式使用项目地点标签并隐藏学校名称。 |
| 账号 | Supabase 邮箱注册、密码登录、数字验证码确认、密码重置、修改昵称、会话恢复；实际邮件投递依赖服务器 SMTP 和模板配置。 |
| 大厅聊天 | Supabase 消息存储和 Realtime 订阅、按地区筛选、历史分页、撤回本人消息、重连同步及轮询补偿；需服务器 RLS、消息表和实时广播配置正确。 |
| 餐厅评价 | 大厅与地点卡片均可进入餐厅专页，按窗口查看和提交评价。管理员窗口新增、删除对接 Supabase；评价内容当前仍保存在本机。 |
| 热点、失物、附近设施 | 地点关联、分类筛选、发布与管理等交互；当前主要为本机数据，尚未整体接入多人同步。 |
| 地点反馈、报修、收藏 | 本机提交、审核或状态管理、地点收藏与常用路线；不代表跨设备工单系统。 |
| 课表 | 支持现有教务导出的 `.xls` 格式、本机解析、按账号保存与教学周设置；尚未直接接入教务账号或同步教务系统。 |
| AUV 校园助手 | 用户主动发送内容，经鉴权网关调用模型；可携带主动选择的地点与课表上下文。模型服务可用性由服务部署决定，未自动读取全部大厅消息或后台 GPS。 |
| 启动与手机适配 | 黑底白金色 OurCampus 启动动画，启动期间加载应用；1.7 提高字体亮度并调整安卓系统栏背景。顶部黑边修复仍需实际手机安装确认。 |

真实账号角色由服务器读取，前端不能自行提升为管理员。室内导航尚缺可靠楼层图，不作为已完成能力。历史方案中的演示角色、旧地图和旧接口描述，以当前代码及上述范围为准。

## 安卓安装与构建

可直接下载 [OurCampus 1.7 安装包](docs/apk/OurCampus-1.7-显示优化.apk)。这是 debug 签名安装包，适合协作演示；正式发布需要负责人保管的签名配置。

自行构建需要 **JDK 21、Android SDK API 36**（当前 Build Tools 35.0.0）及 Gradle 依赖。优先复用已有环境。设置 `JAVA_HOME`，并在不提交的 `android/local.properties` 中填写本机 `sdk.dir`。运行 `npm run android:apk` 后，产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

保留当前 applicationId，升级时递增版本号。不要把服务器密钥改成 `VITE_` 字段；所有 `VITE_` 配置会进入网页和 APK。首页定位仅由用户点击触发，无后台持续定位。

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

源码、SQL、安卓工程、可编辑文档及当前 APK 一起共享；依赖缓存、构建缓存、真实密钥、个人截图和旧版压缩包不纳入仓库。部分保留资料不是当前界面的默认资产。