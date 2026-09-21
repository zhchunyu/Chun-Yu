"""把各阶段的渲染配置统一到**一套光照 + 一套配色**，生成 `blender/configs/rN.json`。

> ★ 为什么需要这个脚本：
>   R0~R4 的成图用的是 `sun 2.9 / sky 0.85 / exposure −0.25 / azim 240`，
>   R5 重标成 `sun 5.8 / sky 0.66 / exposure +0.20 / azim 220`（见 skill 铁律 18）。
>   而全园配色重标 `_RETUNE` 原先内联在 `build_campus_r5.py` 里，渲 R0~R4 时不生效。
>   → 两代成图混排会明显割裂（下 55% 建筑段冷色占比 78~99% vs 17~47%）。
>
>   本脚本是**唯一真源**：光照参数只在这里写一次，所有阶段共用；
>   `palette_retune.py` 一律追加到每个阶段的 `build_extra` 末尾。

用法：
    python make_render_configs.py                     # 优先读 configs/_src/，回退 %TEMP%
    python make_render_configs.py --src-dir <目录> --out-dir <目录>
    python make_render_configs.py --only r2 r3        # 只生成指定阶段
"""
import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
DEF_OUT = os.path.join(BLENDER_DIR, 'configs')
# ★ 源配置（各阶段"相机 + 机位 + 分辨率"清单）默认从**项目内** `configs/_src/` 读。
#   早先只在 %TEMP% 里 —— 临时目录一被清理，整套渲染配方就再也生成不出来。
#   已把 r0~r5_final.json 固化进 `configs/_src/`，%TEMP% 仅作回退。
DEF_SRC = os.path.join(DEF_OUT, '_src')
if not os.path.isdir(DEF_SRC):
    DEF_SRC = os.environ.get('TEMP') or os.environ.get('TMP') or '/tmp'

# ------------------------------------------------------------------
# 光照定案（**唯一真源**）—— 与 MEMORY.md §6 一致
# ------------------------------------------------------------------
LIGHT = dict(
    sun_elev=38,          # 0°=东 90°=北 180°=西 270°=南
    sun_azim=220,
    sun_strength=5.8,     # ★ 与材质反照率是一对，改配色必须重标
    sky_strength=0.66,
    sky_visible=0.72,
    ambient_tint=[1.08, 0.92, 0.70],   # 暖色乘法，只暖照明不动看得见的天空
    exposure=0.20,
    haze_density=1.2e-05,
    cloud_strength=4.5,
    cloud_scale=2.2,
    sun_color=[1.0, 0.905, 0.775],
    view_transform='Khronos PBR Neutral',
)

STAGES = ('r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6')
PALETTE = 'palette_retune.py'

# ------------------------------------------------------------------
# 各阶段专属的额外脚本（插在 PALETTE 之前）
# ------------------------------------------------------------------
# r0 是**语言样板（gate）**，其成图必须看得清新塔本身。但 r0 的管线止于
# `build_campus_r0.py`，不含 r1 的拆除块 —— 结果旧语言的牌坊群 / 阙 / 石狮
# 挡在塔前面（`正立面` 那张塔身下半被阙楼整个遮住）。
# ⇒ 给 r0 单独挂一个**限定范围**的清障脚本：只删建筑构件，不碰场地对象
#   （r1 的 `_DROP` 里那 7 个"待重建"场地对象在 R0 不重建，照搬会开洞）。
# R1~R5 无需挂 —— r1 自己的 `_DROP` 已覆盖同样的构件。
STAGE_EXTRA = {
    'r0': ['clear_old_language_r0.py'],
}

# ------------------------------------------------------------------
# 导出 GLB（R7）—— 只挂在**含完整园区**的那一阶段
# ------------------------------------------------------------------
# ★ 导出配置和渲染配方放同一个源里：`_src/rN_final.json` 是唯一真源，
#   导出参数若单独维护，迟早和"哪一阶段才是完整场景"走散。
# 实测（R6 工程）：1.66M 三角面 / 956k 顶点，其中 **`SITE_树冠` 一个对象占 835k 面**
#   （619 株树 × 约 15 个低面数球）—— 树冠是导出体积的绝对大头，
#   所以抽稀规则按"面数阈值"写，不按对象名写死。
EXPORT_STAGE = 'r6'
EXPORT = {
    'glb': '山河大学_全园_R6.glb',
    'yup': True,                 # glTF / three.js 标准：+Y 向上
    'apply_modifiers': True,
    'draco': True,
    'draco_level': 6,
    'cameras': False,            # 网页侧自己打光布景
    'lights': False,
    'purge_unused_materials': True,
    'decimate': {'min_tris': 200000, 'ratio': 0.35},
    # 网页服务以 web-demo/ 为根，`../exports/` 在根外会被 http.server 拒掉
    # ⇒ 复制一份进站点目录。源永远是 exports/ 那一份。
    'copy_to': 'web-demo/assets/campus.glb',
}


def build(src_dir, out_dir, only=None, res=None, samples=None):
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for st in STAGES:
        if only and st not in only:
            continue
        src = os.path.join(src_dir, '%s_final.json' % st)
        if not os.path.exists(src):
            print('  skip %-4s （找不到 %s）' % (st, src))
            continue
        d = json.load(open(src, encoding='utf-8'))
        be = list(d.get('build_extra') or [])
        for x in STAGE_EXTRA.get(st, ()):
            if x not in be:
                be.append(x)
        if PALETTE not in be:
            be.append(PALETTE)
        jobs = []
        for j in d['jobs']:
            y = dict(j)
            y.update(LIGHT)
            if res:
                y['res_x'], y['res_y'] = res
            if samples:
                y['samples'] = samples
            jobs.append(y)
        out = dict(blend=d.get('blend'), build_extra=be, jobs=jobs)
        if st == EXPORT_STAGE:
            out['export'] = EXPORT
        dst = os.path.join(out_dir, '%s.json' % st)
        json.dump(out, open(dst, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        made.append((st, len(jobs), dst))
        print('  %-4s %2d 张  %s→  %s'
              % (st, len(jobs), '[+GLB] ' if st == EXPORT_STAGE else '', dst))

    # 顺手把光照参数落一份，方便对照
    json.dump(LIGHT, open(os.path.join(out_dir, 'lighting.json'), 'w',
                          encoding='utf-8'), ensure_ascii=False, indent=1)
    total = sum(n for _s, n, _d in made)
    print('[configs] %d 个阶段 / 共 %d 张' % (len(made), total))
    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src-dir', default=DEF_SRC)
    ap.add_argument('--out-dir', default=DEF_OUT)
    ap.add_argument('--only', nargs='*', default=None)
    ap.add_argument('--res', nargs=2, type=int, default=None,
                    help='覆盖分辨率，如 --res 800 450（做候选图）')
    ap.add_argument('--samples', type=int, default=None)
    a = ap.parse_args()
    if not os.path.isdir(a.src_dir):
        sys.exit('源目录不存在: %s' % a.src_dir)
    print('[configs] 源 %s' % a.src_dir)
    print('[configs] 出 %s' % a.out_dir)
    build(a.src_dir, a.out_dir, a.only, a.res, a.samples)


if __name__ == '__main__':
    main()
