# -*- coding: utf-8 -*-
"""make_site.py —— 把交付物组装成一个**可静态托管的站点目录**（用于在线部署）。

产物：`02-三维资产/site/`

     site/
       index.html                      ← 站点入口（本脚本生成）
       renders/                        ← 71 张网页用缩图（JPEG）+ 总览对照页
         总览_R0-R6.html
         R0_垂直书院_透视.jpg …
       建模图集/
         山河大学_三维建模图集.html      ← 桌面版（图片已重指到 renders/*.jpg）
         山河大学_三维建模图集_手机版.html ← 单文件，原样复制
       preview.html + src/ + serve.cmd + vendor/ + assets/campus.glb
                                       ← 3D 全园预览（three.js + GLB）
                                          serve.cmd = 本地起静态服务的双击脚本

为什么不能直接部署 `02-三维资产/`：
  该目录 **1.9 GB**，其中 `blender/projects/*.blend` 占 1.2 GB —— 都是**可由脚本重新生成**
  的中间产物。上传它们既慢又无意义。

为什么图片要转 JPEG 并改扩展名：
  站点里所有页面引用的都是 **`.png`**（图集里还是百分号编码的中文名）。
  本脚本统一把 1600×900 的 PNG（约 1.8 MB/张）缩成 1400 px 的 JPEG（约 160 KB/张），
  并把引用里的 `.png"` 改成 `.jpg"` —— 这样**页面代码一个字都不用改**，
  只是换个图源目录。71 张合计从约 106 MB 降到约 11 MB。

用法：
    python make_site.py            # 全量构建
    python make_site.py --no-img   # 只重建 HTML（图片已在，省时间）
"""
import os
import re
import shutil
import sys
import urllib.parse

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSET = os.path.dirname(HERE)                    # 02-三维资产
WS = os.path.dirname(ASSET)                      # 春雨工作区
SITE = os.path.join(ASSET, 'site')

RENDERS = os.path.join(ASSET, 'renders')
ATLAS_DIR = os.path.join(ASSET, '建模图集')
WEB = os.path.join(ASSET, 'web-demo')

IMG_W = 1400
IMG_Q = 85

# 站点入口页 —— 内联样式，不依赖任何外部文件
INDEX = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>山河大学 · 三维建模成果</title>
<!-- 内联 favicon：避免浏览器请求 /favicon.ico 拿到 404（控制台会报一条无意义的错） -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232B2E33'/%3E%3Cpath d='M5 23 L12.5 12 L17.5 18 L21.5 13.5 L27 23 Z' fill='%23C9A87C'/%3E%3C/svg%3E">
<style>
  :root{--ink:#2B2E33;--paper:#F4F2EE;--card:#fff;--line:#D8D4CC;
        --sub:#6C6862;--wood:#C9A87C;--copper:#B07B45;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
       font:15px/1.75 "PingFang SC","Microsoft YaHei",-apple-system,sans-serif;}
  .wrap{max-width:1000px;margin:0 auto;padding:48px 20px 60px;}
  header{border-bottom:2px solid var(--ink);padding-bottom:20px;margin-bottom:8px;}
  h1{font-size:30px;margin:0 0 8px;letter-spacing:.04em;}
  .sub{color:var(--sub);font-size:13.5px;letter-spacing:.1em;}
  .concept{font-size:19px;letter-spacing:.2em;color:var(--copper);
           border-left:3px solid var(--copper);padding-left:14px;margin:26px 0 8px;}
  .lead{color:var(--sub);font-size:14px;margin:0 0 30px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;}
  a.card{display:block;background:var(--card);border:1px solid var(--line);
         border-radius:4px;padding:20px 22px;text-decoration:none;color:inherit;
         transition:.18s;}
  a.card:hover{border-color:var(--copper);transform:translateY(-2px);
               box-shadow:0 6px 20px rgba(0,0,0,.07);}
  a.card h3{margin:0 0 6px;font-size:16.5px;}
  a.card p{margin:0;color:var(--sub);font-size:13px;line-height:1.7;}
  a.card .tag{display:inline-block;font-size:11px;color:var(--copper);
              border:1px solid var(--line);border-radius:3px;padding:1px 7px;margin-bottom:9px;}
  h2{font-size:17px;margin:44px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line);}
  table{width:100%;border-collapse:collapse;font-size:13.5px;}
  th,td{border:1px solid var(--line);padding:8px 11px;text-align:left;}
  th{background:#F0EEE9;font-weight:600;white-space:nowrap;}
  td.v{color:var(--copper);font-weight:600;white-space:nowrap;}
  footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);
         color:var(--sub);font-size:12.5px;line-height:1.95;}
  .tw{overflow-x:auto;}
  @media (max-width:640px){
    .wrap{padding:30px 16px 44px;} h1{font-size:23px;}
    .concept{font-size:16px;letter-spacing:.14em;}
  }
</style></head><body><div class="wrap">

<header>
  <h1>山河大学 · 三维建模成果</h1>
  <div class="sub">校园场景程序化建模 / 实景渲染 / 轻量化交付</div>
</header>

<div class="concept">藏山纳智 · 云廊书院</div>
<p class="lead">
  以山为院 · 以水为径 · 以云为廊 —— 七个设计阶段（R0~R6）+ 全园整合（R7），
  71 张实景渲染成图，全园轻量化 GLB。全部几何由脚本生成，渲染为确定性过程。
</p>

<div class="grid">
  <a class="card" href="./preview.html">
    <span class="tag">交互</span>
    <h3>全园 3D 预览</h3>
    <p>浏览器里直接浏览 153 万面的全园模型，含 7 个机位预设。
       拖拽旋转、滚轮缩放、<kbd>1</kbd>–<kbd>7</kbd> 切机位。<br>
       <span style="color:#B07B45">★ 必须通过 http(s) 打开；本地请双击 <code>serve.cmd</code>，
       不要直接双击 HTML 文件。</span></p>
  </a>
  <a class="card" href="./建模图集/山河大学_三维建模图集.html">
    <span class="tag">图集</span>
    <h3>三维建模图集</h3>
    <p>五章陈列：设计概念 / 技术路线 / 分阶段成果（32 张代表图 + 几何要点）/
       成果指标 / 说明。</p>
  </a>
  <a class="card" href="./renders/总览_R0-R6.html">
    <span class="tag">对照</span>
    <h3>分阶段对照总览</h3>
    <p>R0~R7 每一版的改动前后并排对照，附逐像素 A/B 量化与配色合规度。</p>
  </a>
  <a class="card" href="./建模图集/山河大学_三维建模图集_手机版.html">
    <span class="tag">手机</span>
    <h3>图集 · 手机版</h3>
    <p>单文件版，图片全部内嵌。适合手机上翻看，也可离线保存。</p>
  </a>
</div>

<h2>成果指标</h2>
<div class="tw"><table>
  <tr><th>指标</th><th>数值</th><th>口径</th></tr>
  __ROWS__
</table></div>

<footer>
  <b>说明</b>：校园为完全虚构设定，与任何现实院校无关；图面与模型中不含校名、Logo、
  指导教师信息，也不含任何题字（匾额均为空白石板）。<br>
  模型按 1 : 1 真实尺度建立（1 单位 = 1 米）；总平面阶段以 1 SVG 像素 = 2.4 m 换算。<br>
  本页与图集均由脚本从渲染产物生成，可重新构建。
</footer>

</div></body></html>
"""

METRICS = [
    ('成图总量', '71 张', 'R0~R6 七个阶段 + 8 张 R7 整合图，1600 × 900（R0 正立面 1000 × 1600）'),
    ('渲染引擎', 'Cycles · Khronos PBR Neutral', 'sun 38° / strength 5.8 · 天空 0.66 · 雾密度 1.2e-5'),
    ('全园模型', '2,317,949 面', '393 对象 · 72 材质（导出前，r6 定版）'),
    ('GLB 交付', '5.70 MB', '1,535,187 面 · 54 材质 · Draco 压缩 · 剔除 Haze 与 7 个未引用材质'),
    ('智慧环廊', '1631.9 m', '沿 18 顶点折线，绕案山不跨案山，沿线 15 处垂直交通'),
    ('滨水挑台', '2618.7 m', '连续可上人岸线，常态外挑出水 3.0 m'),
    ('垂直书院', '93.00 m', '基座 42 × 42 × 11.25 + 塔身 9 层 × 7.40（塔 / 楼 = 2.04）'),
]


def shrink(src, dst):
    """PNG → 网页用 JPEG。"""
    im = Image.open(src).convert('RGB')
    if im.width > IMG_W:
        im = im.resize((IMG_W, round(IMG_W * im.height / im.width)), Image.LANCZOS)
    im.save(dst, 'JPEG', quality=IMG_Q, optimize=True, progressive=True)
    return os.path.getsize(dst)


def rewrite_png_to_jpg(path):
    """把页面里 `<img src="....png">` 改成 `.jpg` —— 页面代码一个字不用改。"""
    with open(path, encoding='utf-8') as fh:
        h = fh.read()
    n = len(re.findall(r'src="[^"]+\.png"', h))
    h = re.sub(r'(src="[^"]+)\.png"', r'\1.jpg"', h)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(h)
    return n


def remap_external(site_html, src_html, site_root):
    """把页面里 `../` 开头的图片引用**改写成站点内的路径**，并把源图镜像进站点。

    ★ 为什么不能"保持原相对路径"（这是踩过的坑）：
      源页面在 `02-三维资产/renders/`，`../../08-交付与归档/…` 解析到**工作区根**。
      但站点里页面在 `site/renders/`，`../..` 只到 **`02-三维资产/`** ——
      **少一层**。按原路径镜像会写到站点外面，甚至凭空建出
      `02-三维资产/08-交付与归档/`（本次实测踩到，已清理）。
      ⇒ 正确做法是**改写引用**，把外部图收进 `site/_archive/<工作区内的相对路径>`。

    返回 (改写条数, 镜像张数, 缺失清单)。
    """
    with open(site_html, encoding='utf-8') as fh:
        h = fh.read()
    base_src = os.path.dirname(src_html)
    base_dst = os.path.dirname(site_html)

    refs = sorted({u for u in re.findall(r'src="([^"]+)"', h) if u.startswith('..')})
    n_new, miss = 0, []
    for u in refs:
        s = os.path.normpath(os.path.join(base_src, urllib.parse.unquote(u)))
        if not os.path.exists(s):
            miss.append(u)
            continue
        rel = os.path.relpath(s, WS)                       # 相对工作区根
        tgt = os.path.join(site_root, '_archive', rel)
        tgt = os.path.splitext(tgt)[0] + '.jpg'
        os.makedirs(os.path.dirname(tgt), exist_ok=True)
        if not os.path.exists(tgt):
            shrink(s, tgt)
            n_new += 1
        new = os.path.relpath(tgt, base_dst).replace(os.sep, '/')
        h = h.replace('src="%s"' % u, 'src="%s"' % new)
    with open(site_html, 'w', encoding='utf-8') as fh:
        fh.write(h)
    return len(refs), n_new, miss


def main():
    no_img = '--no-img' in sys.argv

    os.makedirs(os.path.join(SITE, 'renders'), exist_ok=True)
    os.makedirs(os.path.join(SITE, '建模图集'), exist_ok=True)

    # ---- 1. 71 张成图 → 缩图 ----
    names = sorted(f for f in os.listdir(RENDERS) if f.endswith('.png'))
    if no_img:
        print('[site] 跳过图片转换（--no-img），已有 %d 张'
              % len([f for f in os.listdir(os.path.join(SITE, 'renders'))
                     if f.endswith('.jpg')]))
    else:
        total = 0
        for i, f in enumerate(names, 1):
            dst = os.path.join(SITE, 'renders', f[:-4] + '.jpg')
            total += shrink(os.path.join(RENDERS, f), dst)
            if i % 15 == 0:
                print('[site] 缩图 %d/%d' % (i, len(names)))
        print('[site] 成图 %d 张 → JPEG，合计 %.1f MB'
              % (len(names), total / 1048576))

    # ---- 2. 总览对照页（同目录，只改扩展名）----
    src = os.path.join(RENDERS, '总览_R0-R6.html')
    if os.path.exists(src):
        dst = os.path.join(SITE, 'renders', '总览_R0-R6.html')
        shutil.copy2(src, dst)
        n_ref, n_new, miss = remap_external(dst, src, SITE)
        print('[site] 总览页：重写 %d 处图片引用；外部归档引用 %d 条 → 镜像新图 %d 张%s'
              % (rewrite_png_to_jpg(dst), n_ref, n_new,
                 ('，缺 %d 条' % len(miss)) if miss else ''))
        for m in miss:
            print('   ✗ 归档缺图', m)

    # ---- 3. 建模图集（桌面版改扩展名；手机版自包含，原样拷）----
    for f, rw in (('山河大学_三维建模图集.html', True),
                  ('山河大学_三维建模图集_手机版.html', False)):
        src = os.path.join(ATLAS_DIR, f)
        if not os.path.exists(src):
            print('[site] ⚠ 缺文件：%s' % f)
            continue
        dst = os.path.join(SITE, '建模图集', f)
        shutil.copy2(src, dst)
        print('[site] 图集 %s：%s' % (f, '重写 %d 处引用' % rewrite_png_to_jpg(dst)
                                     if rw else '单文件，原样复制'))

    # ---- 4. 3D 预览（three.js + GLB）----
    shutil.copy2(os.path.join(WEB, 'preview.html'), os.path.join(SITE, 'preview.html'))
    os.makedirs(os.path.join(SITE, 'src'), exist_ok=True)
    shutil.copy2(os.path.join(WEB, 'src', 'preview.js'),
                 os.path.join(SITE, 'src', 'preview.js'))
    # ★ serve.cmd：本地起静态服务的双击脚本（2026-09-25 加）。
    #   为什么站点里要带它：preview.html 的脚本是 ES module，`file://` 下会被
    #   CORS 拒绝 ⇒ 双击 index.html 打开的人会看到 3D 预览"永远转圈"。
    #   页面上给的出路之一就是"双击 serve.cmd 再走 http://localhost:8123"，
    #   所以这个文件必须跟着产物一起走，否则那条指引是死的。
    _serve = os.path.join(WEB, 'serve.cmd')
    if os.path.exists(_serve):
        shutil.copy2(_serve, os.path.join(SITE, 'serve.cmd'))
    else:
        print('[site] ⚠ 未找到 web-demo/serve.cmd —— 本地打开指引会失效，请检查')
    for d in ('vendor', 'assets'):
        s = os.path.join(WEB, d)
        t = os.path.join(SITE, d)
        if os.path.isdir(t):
            shutil.rmtree(t)
        shutil.copytree(s, t)
    print('[site] 3D 预览：preview.html + src/preview.js + serve.cmd + vendor/ + assets/campus.glb')

    # ---- 5. 入口页 ----
    rows = '\n  '.join('<tr><td class="k">%s</td><td class="v">%s</td><td>%s</td></tr>' % m
                       for m in METRICS)
    with open(os.path.join(SITE, 'index.html'), 'w', encoding='utf-8') as fh:
        fh.write(INDEX.replace('__ROWS__', rows))
    print('[site] 入口页 index.html')

    # ---- 6. 自检：页面引用的图片是否都在站点里 ----
    miss, checked = [], 0
    for root, _, files in os.walk(SITE):
        for fn in files:
            if not fn.endswith('.html'):
                continue
            p = os.path.join(root, fn)
            with open(p, encoding='utf-8') as fh:
                h = fh.read()
            for u in re.findall(r'src="([^"]+)"', h):
                if u.startswith(('http', 'data:')):
                    continue
                checked += 1
                if not os.path.exists(os.path.join(root, urllib.parse.unquote(u))):
                    miss.append('%s → %s' % (fn, u))
    print('[site] 自检：%d 条本地图片引用，断链 %d 条' % (checked, len(miss)))
    for m in miss[:10]:
        print('   ✗', m)

    sz = sum(os.path.getsize(os.path.join(r, f))
             for r, _, fs in os.walk(SITE) for f in fs)
    print('[site] 站点总体积 %.1f MB → %s' % (sz / 1048576, SITE))
    return 1 if miss else 0


if __name__ == '__main__':
    sys.exit(main())
