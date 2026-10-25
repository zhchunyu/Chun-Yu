# Android 下载与使用

## OurCampus 1.17 体验版

**[下载 OurCampus-1.17.apk](https://github.com/zhchunyu/Chun-Yu/releases/download/v1.17/OurCampus-1.17.apk)** · [GitHub Release](https://github.com/zhchunyu/Chun-Yu/releases/tag/v1.17) · [用户反馈](../README.md#交流与反馈)

| 项目 | 本次安装包 |
| --- | --- |
| 版本 | 1.17 |
| versionCode | 18 |
| 最低系统 | Android 7.0 / API 24 |
| targetSdk | 36 |
| 包名 | `cn.edu.sxau.campustwin` |
| 文件大小 | 47,428,964 字节，约 45.23 MiB |
| 发布日期 | 2026-10-25 |

文件由团队提供。发布时只规范下载文件名，未重新打包，未修改文件内容；已核验 APK 的 ZIP 完整性和 Manifest 版本字段。上述检查不等同于全部设备、后台推送或业务流程验收。

## 安装

1. 在 Android 手机上打开下载链接，保存后缀为 `.apk` 的文件。
2. 打开文件，按系统提示允许当前下载来源安装应用。
3. 首次启动后按需登录并授权所使用的功能。遇到安装或使用问题，请保留错误提示并反馈。

此次安装包的包名为 `cn.edu.sxau.campustwin`，仓库 1.11 构建配置使用 `cn.edu.campus.campustwin`。Android 会将不同包名视为不同应用，通常不会覆盖旧版，本机数据也不会自动迁移。保留需要的旧数据后再决定是否清理旧应用。

## 文件校验

SHA-256：

```text
71899917da1a404c80c01052f73cf3782a7e3c81ebe7bbec647aba75561baedc
```

Windows PowerShell：

```powershell
Get-FileHash .\OurCampus-1.17.apk -Algorithm SHA256
```

也可下载 Release 中的 `SHA256SUMS.txt` 对照。校验值用于确认文件一致性。

## 源码与安装包的关系

本次上传的是团队另行提供的 1.17 二进制安装包；发布前的仓库 `main` Android 配置仍为 **1.11 / versionCode 12**。本次仅更新首页、下载及资源索引，没有以修改版本号的方式替代对应源码同步，因此不宣称当前 `main` 可以逐字节重建此 APK。

1.17 的安装包版本信息以本页和 Release 为准；仓库源码的实现与构建步骤见[应用说明](../apps/ourcampus/README.md)和[快速开始](quickstart.md)。已有后台和模型接入记录保留各自日期。

## 反馈

使用[微信反馈群](../README.md#交流与反馈)或 [GitHub Issues](https://github.com/zhchunyu/Chun-Yu/issues)。请提供版本、设备、复现步骤和截图；截图发布前遮挡个人资料。

[返回项目首页](../README.md)
