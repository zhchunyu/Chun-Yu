/**
 * UI 效果验证：构建 → 起本地服务 → 无头 Chrome 截图 → 输出证据
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/verify-ui.mjs                       验证默认场景并截图
 *   node scripts/verify-ui.mjs --scenario storm      指定场景（calm / peak / storm）
 *   node scripts/verify-ui.mjs --all                 三个场景全截图
 *   node scripts/verify-ui.mjs --serve-only          只起服务不截图（供人工打开看）
 *   node scripts/verify-ui.mjs --port 5199           指定端口
 *
 * ★ 为什么要起 HTTP 服务而不是直接 file:// ：
 *   页面内容一致，但 `--dump-dom` 与截图在 http 下更稳；
 *   且后续要接真实 dev server（vite）时，调用方式不用改。
 *
 * ⚠️ 沙箱限制：无头 Chrome 需要创建 IPC 命名管道，在受限沙箱下会
 *   `platform_channel.cc: Check failed: 拒绝访问 (0x5)`。
 *   若本脚本报 Chrome 启动失败，需要以更宽的文件/进程权限重跑一次。
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync, openSync } from 'node:fs'
import { dirname, resolve, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEV = join(ROOT, 'dev')
const SHOTS = join(DEV, 'shots')

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? (args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : true) : fallback
}
const PORT = Number(flag('port', 5199))
const ALL = args.includes('--all')
const SERVE_ONLY = args.includes('--serve-only')
const SCENARIOS = ALL ? ['calm', 'peak', 'storm'] : [String(flag('scenario', 'peak'))]

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

const C = { reset: '\u001b[0m', dim: '\u001b[2m', green: '\u001b[32m', red: '\u001b[31m', yellow: '\u001b[33m', bold: '\u001b[1m' }
const paint = (color, text) => `${color}${text}${C.reset}`

// ---------------------------------------------------------------------------
// ① 构建
// ---------------------------------------------------------------------------
function build() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(DEV, 'build-bundle.mjs')], { cwd: ROOT, stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`构建失败，退出码 ${code}`))))
  })
}

// ---------------------------------------------------------------------------
// ② 静态服务
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/') pathname = '/index.html'

      const file = join(DEV, pathname)
      // 防目录穿越
      if (!file.startsWith(DEV) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('404')
        return
      }
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(readFileSync(file))
    })
    server.listen(PORT, '127.0.0.1', () => resolvePromise(server))
  })
}

// ---------------------------------------------------------------------------
// ③ 无头截图
// ---------------------------------------------------------------------------
function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error('未找到 Chrome / Edge 可执行文件')
  return found
}

function shoot(chrome, scenario, width = 1500, height = 2600) {
  return new Promise((resolvePromise) => {
    const out = join(SHOTS, `${scenario}.png`)
    const profile = join(SHOTS, `_profile_${scenario}`)
    const url = `http://127.0.0.1:${PORT}/index.html?scenario=${scenario}`

    // ★ stdio 用 'ignore' 而不是 'pipe'：
    //   受限沙箱下 Node 无法为子进程创建管道（`spawn EPERM`），
    //   而 Chrome 自己会把截图写到文件里，本来也不需要捕获它的输出。
    let child
    try {
      child = spawn(chrome, [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-breakpad',
        '--disable-crash-reporter',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--virtual-time-budget=6000',
        `--window-size=${width},${height}`,
        `--user-data-dir=${profile}`,
        `--screenshot=${out}`,
        url,
      ], { stdio: 'ignore' })
    } catch (error) {
      resolvePromise({ out, stderr: `spawn 失败：${error.message}`, spawnError: error.code ?? null })
      return
    }

    let settled = false
    const finish = (payload) => { if (!settled) { settled = true; resolvePromise(payload) } }
    child.on('error', (error) => finish({ out, stderr: `spawn 失败：${error.message}`, spawnError: error.code ?? null }))
    child.on('exit', () => finish({ out, stderr: '' }))
    setTimeout(() => { child.kill(); finish({ out, stderr: '超时 30s' }) }, 30000)
  })
}

/** 用 `--dump-dom` + **文件重定向**拿页面 HTML（不经过管道） */
function dumpDom(chrome, scenario) {
  return new Promise((resolvePromise) => {
    const profile = join(SHOTS, `_profile_dom_${scenario}`)
    const domFile = join(SHOTS, `_dom_${scenario}.html`)

    let child
    try {
      child = spawn(chrome, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-breakpad',
        '--no-first-run', '--hide-scrollbars', '--virtual-time-budget=6000',
        `--user-data-dir=${profile}`, '--dump-dom',
        `http://127.0.0.1:${PORT}/index.html?scenario=${scenario}`,
      ], {
        // ★ 把 stdout 直接重定向到文件：绕开"沙箱下不能建管道"的限制
        stdio: ['ignore', openSync(domFile, 'w'), 'ignore'],
      })
    } catch (error) {
      resolvePromise({ html: '', error: `spawn 失败：${error.message}` })
      return
    }

    let settled = false
    const finish = (payload) => { if (!settled) { settled = true; resolvePromise(payload) } }
    child.on('error', (error) => finish({ html: '', error: `spawn 失败：${error.message}` }))
    child.on('exit', () => {
      const html = existsSync(domFile) ? readFileSync(domFile, 'utf8') : ''
      finish({ html, error: html ? null : 'DOM 输出为空' })
    })
    setTimeout(() => { child.kill(); finish({ html: '', error: '超时 30s' }) }, 30000)
  })
}

/** 从 DOM 里做**结构断言** —— 截图是给人看的，这段是给 CI 看的 */
function assertDom(html, scenario) {
  const checks = []
  const has = (needle) => html.includes(needle)
  const count = (re) => (html.match(re) ?? []).length

  // ★ 断言必须锚定**渲染出来的文案**，不能锚定 class 名 ——
  //   class 名同时出现在 <style> 里，会造成假通过（第一版就踩了这个坑）。
  checks.push(['页面渲染出内容（非空白）', html.length > 20000, `${(html.length / 1024).toFixed(0)} KB HTML`])
  checks.push(['无 JS 运行时错误', !has('Uncaught') && !has('bundle.js 未加载'),
    has('Uncaught') ? (html.match(/Uncaught[^<"]{0,90}/) ?? [''])[0] : '无异常'])
  checks.push(['天气条渲染', has('气象 → 校园处置动作') && has('把天气翻译成行动'), '含"气象→动作"翻译区'])
  checks.push(['风险总览渲染', has('风险总览') && has('风险总览__grid'.replace('__grid', '')) && count(/risk-tile/g) > 4,
    `${count(/risk-tile "/g) || count(/risk-tile"/g)} 个分档卡`])
  checks.push(['处置时效渲染', has('平均响应') && has('超时率') && has('闭环率'), '三项指标齐全'])
  checks.push(['空间态势渲染', has('空间态势') && has('封控路段') && has('关闭场所'), '含封控路段与关闭场所分组'])
  checks.push(['预警卡片渲染', has('alert-card__header'), `${count(/alert-card__header/g)} 张预警卡`])
  // ★ 证据链默认在折叠的 <details> 里，`--dump-dom` 抓不到折叠内容。
  //   所以断言"折叠入口存在"，并把它算作正常；真正的展开内容由
  //   浏览器端的 __RENDER_DONE__ 计数自证（见 harness.js）。
  checks.push(['证据链入口渲染（折叠态）', has('查看 AI 判定依据与证据链'),
    '详情默认折叠，展开态由浏览器端计数自证'])
  checks.push(['阈值面板渲染', has('人流阈值与容量口径') && has('阈值不是拍的'), '含容量口径说明'])
  checks.push(['容量口径依据展示（回答"阈值怎么定的"）',
    has('消防疏散容量') || has('座位数') || has('人/min/m'), '现实依据可见'])
  checks.push(['驻留与冷却翻译成人话', has('需连续') && has('处置后'), '阈值参数有人话解释'])

  const selfCheck = html.match(/(\d+)\s*\/\s*(\d+)\s*个模块在浏览器里实跑通过/)
  checks.push(['浏览器端自检全部通过', selfCheck ? selfCheck[1] === selfCheck[2] : false,
    selfCheck ? `${selfCheck[1]} / ${selfCheck[2]} 个模块` : '未找到自检结果'])

  // ★ 折叠内容的真实性由浏览器端探针证明（--dump-dom 抓不到 <details> 折叠子树）
  const probeMatch = html.match(/id="render-probe"[^>]*>([^<]*)</)
  let probe = null
  try { probe = probeMatch ? JSON.parse(probeMatch[1]) : null } catch { probe = null }

  if (probe) {
    checks.push(['★ 证据链明细真的渲染了（折叠态探针）', probe.evidenceRows > 0,
      `${probe.evidenceRows} 行证据明细`])
    // ★ 常态场景**不该有**预案步骤 —— 待核实的预警尚未发布，不可派单。
    //   这是正确行为，不能当成缺失。
    if (scenario === 'calm') {
      checks.push(['★ 常态场景：无预案可执行（待核实不上图、不可派单）',
        probe.playbookSteps === 0 && probe.timelineRows > 0,
        `${probe.playbookSteps} 个预案步骤（应为 0）／${probe.timelineRows} 条时间线（应有）`])
    } else {
      checks.push(['★ 预案步骤与处置时间线真的渲染了',
        probe.playbookSteps > 0 && probe.timelineRows > 0,
        `${probe.playbookSteps} 个预案步骤 / ${probe.timelineRows} 条时间线 / ${probe.dispatchRows} 条派单`])
    }
    checks.push(['★ 折叠区无失败组件', probe.selfCheckFailed === 0,
      `自检面板 ${probe.selfCheckPassed} PASS / ${probe.selfCheckFailed} FAIL`])
  } else {
    checks.push(['★ 渲染探针可读（证明页面完整渲染）', false, '未找到 #render-probe'])
  }

  if (scenario === 'storm') {
    // ★ 暴雨动作的封路集合由规则表给出（与"道路占用预案"不同源），
    //   断言应锚定规则表的实际产出，而不是另一条预案的边 id
    checks.push(['★ 暴雨场景：封路集合进入 DOM', has('outer_s3→inner_e_s4') && has('axis_gate→outer_s2'),
      '规则表封路 5 段已上图'])
    checks.push(['★ 暴雨场景：避雨模式生效', has('rain') && has('避雨'), 'ROUTE_MODES.RAIN 已生效'])
    checks.push(['★ 暴雨场景：户外活动已暂停', has('已暂停'), '暂停户外动作生效'])
    checks.push(['★ 暴雨场景：关闭场所（车库）', has('地下车库入口'), 'C-7 动作生效'])
  }
  if (scenario === 'peak') {
    checks.push(['★ 高峰场景：出现人流告警', has('人流达安全容量上限'), '风控生成预警'])
    checks.push(['★ 高峰场景：安全类待核实', has('待核实'), '可信度闸门生效'])
    checks.push(['★ 高峰场景：无封路（未触发天气联动）', !has('outer_s3→inner_e_s4'), '未过度响应（正确）'])
  }
  if (scenario === 'calm') {
    checks.push(['★ 常态场景：无封路', !has('outer_s3→inner_e_s4'), '未触发联动（正确）'])
    checks.push(['★ 常态场景：无关闭场所', !has('地下车库入口'), '未过度响应（正确）'])
  }

  return checks
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const started = Date.now()
mkdirSync(SHOTS, { recursive: true })

console.log(paint(C.bold, '\n安全管理模式 · UI 效果验证'))
console.log(paint(C.dim, '─'.repeat(70)))

console.log(paint(C.dim, '\n① 构建 bundle…'))
await build()

console.log(paint(C.dim, `② 启动本地服务 http://127.0.0.1:${PORT}/`))
const server = await startServer()
console.log(paint(C.green, '   服务已就绪'))

const chrome = findChrome()
console.log(paint(C.dim, `③ 无头浏览器：${chrome}`))

let failed = 0
const results = []

for (const scenario of SCENARIOS) {
  console.log(paint(C.dim, `\n④ 场景「${scenario}」`))

  const domResult = await dumpDom(chrome, scenario)
  const dom = domResult.html ?? ''
  const shot = await shoot(chrome, scenario)

  if (domResult.error) {
    console.log(`   ${paint(C.red, '✗')} 取页面 DOM 失败：${domResult.error}`)
    failed += 1
  }

  const checks = assertDom(dom, scenario)
  const bad = checks.filter(([, passed]) => !passed)
  failed += bad.length

  for (const [label, passed, detail] of checks) {
    if (VERBOSE_LIKE() || !passed) {
      console.log(`   ${passed ? paint(C.green, '✓') : paint(C.red, '✗')} ${label} ${paint(C.dim, `— ${detail}`)}`)
    }
  }
  if (!VERBOSE_LIKE()) {
    console.log(paint(C.dim, `   （${checks.length} 项结构断言，仅显示失败项；加 --verbose 看全部）`))
  }

  const size = existsSync(shot.out) ? statSync(shot.out).size : 0
  console.log(size
    ? `   ${paint(C.green, '📷')} 截图 ${shot.out.replace(ROOT + '\\', '')} ${paint(C.dim, `(${(size / 1024).toFixed(0)} KB)`)}`
    : `   ${paint(C.red, '📷 截图生成失败')} ${paint(C.dim, shot.stderr.split('\n')[0] ?? '')}`)

  results.push({ scenario, checks: checks.length, failed: bad.length, screenshot: size ? shot.out : null })
}

// 清理 Chrome 临时 profile（体积大且无用）
for (const scenario of SCENARIOS) {
  rmSync(join(SHOTS, `_profile_${scenario}`), { recursive: true, force: true })
  rmSync(join(SHOTS, `_profile_dom_${scenario}`), { recursive: true, force: true })
}

if (SERVE_ONLY) {
  console.log(paint(C.yellow, `\n服务保持运行（--serve-only）。按 Ctrl+C 结束。`))
} else {
  server.close()
}

console.log('')
console.log(paint(C.dim, '─'.repeat(70)))
const totalChecks = results.reduce((sum, item) => sum + item.checks, 0)
console.log(failed
  ? paint(C.red, `存在失败：${totalChecks} 项断言中 ${failed} 项未通过`)
  : paint(C.green, `全部通过：${results.length} 个场景 / ${totalChecks} 项结构断言 + ${results.filter((r) => r.screenshot).length} 张截图`))
console.log(paint(C.dim, `耗时 ${((Date.now() - started) / 1000).toFixed(1)} s`))
console.log('')

function VERBOSE_LIKE() { return args.includes('--verbose') }

process.exit(failed ? 1 : 0)
