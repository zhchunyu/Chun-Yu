# 保留资产（不打包、不提交）

本目录存放**真实校园来源**的历史资产，已从 `public/` 移出，原因：

- 比赛材料红线要求不得出现学校名称/Logo 等信息，而这两个文件来自真实校园数据；
- 它们**未被任何代码引用**，移出后不影响 App 运行与构建。

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `campus-3d-model.glb` | 约 41 MB | 真实校园三维提取模型（原 `sxau-campus-extracted.glb`），GLB 内部节点名已中性化；App 从未加载它 |
| `campus-plan.jpeg` | 约 60 KB | 早期导入的真实校园平面图副本，已被 `public/assets/campus-plan-hd.jpg` 取代 |

> ⚠️ 打包提交物（源码包 / APK）时请排除本目录。
> 如需恢复，移回 `public/assets/` 并同步 `scripts/prepare-pages.mjs` 即可。
