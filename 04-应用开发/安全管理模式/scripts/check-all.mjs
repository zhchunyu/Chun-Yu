/**
 * 统一自检入口（零依赖）
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/check-all.mjs            跑全部模块自检
 *   node scripts/check-all.mjs --verbose  打印每一项检查明细
 *   node scripts/check-all.mjs --json     输出 JSON（供 CI 消费）
 *   node scripts/check-all.mjs --skip-unverified
 *                                         跳过「待人工验收」的模块（数据层由并行开发产出时用）
 *
 * 为什么用这个而不是 jest/vitest：
 *   本模块要能在**没有 node_modules** 的环境里验证（例如刚 clone 下来、
 *   或者只有源码快照的场景）。所有自检都写在模块内部、零依赖，
 *   这个脚本只是把它们收集起来统一报告。
 *   拷入 CampusTwin 后可以改用 vitest，但没必要 —— 它已经能跑。
 */

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/**
 * 模块登记表
 *
 * `verified` 标记该模块是否已被主开发流程人工验收过。
 * 并行开发产出的模块在验收前标 false，`--skip-unverified` 会跳过它们，
 * 避免"别人的模块挂了导致我的 CI 红"。
 */
export const MODULES = [
  { path: 'src/domain/crowd.js', layer: 'domain', title: '人流容量口径与数值模型', verified: true },
  { path: 'src/domain/crowdRisk.js', layer: 'domain', title: '人流阈值风控（迟滞/驻留/冷却/趋势/传播）', verified: true },
  { path: 'src/domain/alert.js', layer: 'domain', title: '预警分级矩阵与状态机', verified: true },
  { path: 'src/domain/playbook.js', layer: 'domain', title: '处置预案库与动作原子', verified: true },
  { path: 'src/domain/safetyStore.js', layer: 'domain', title: '接线中枢（四条路线整合）', verified: true },
  { path: 'src/data/weatherDataSource.js', layer: 'data', title: '天气数据源（W3 场景快照）', verified: true },
  { path: 'src/data/weatherActionMap.js', layer: 'data', title: '气象 → 校园处置动作映射', verified: true },
  { path: 'src/data/safetyBaseline.js', layer: 'data', title: '通行热度异常检测基线', verified: true },
  { path: 'src/features/alerts/weatherIntegration.js', layer: 'features', title: '天气 → 安全态势集成适配', verified: true },
]

const args = process.argv.slice(2)
const VERBOSE = args.includes('--verbose')
const AS_JSON = args.includes('--json')
const SKIP_UNVERIFIED = args.includes('--skip-unverified')

const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', bold: '\u001b[1m',
  green: '\u001b[32m', red: '\u001b[31m', yellow: '\u001b[33m', cyan: '\u001b[36m',
}
const paint = (color, text) => (AS_JSON ? text : `${color}${text}${C.reset}`)

async function runModule(entry) {
  const absolute = resolve(ROOT, entry.path)
  if (!existsSync(absolute)) {
    return { ...entry, status: 'missing', checks: [], error: `文件不存在：${entry.path}` }
  }

  let mod
  try {
    mod = await import(pathToFileURL(absolute).href)
  } catch (error) {
    return { ...entry, status: 'error', checks: [], error: `加载失败：${error.message}` }
  }

  if (typeof mod.runSelfCheck !== 'function') {
    return { ...entry, status: 'no-selfcheck', checks: [], error: '未导出 runSelfCheck()' }
  }

  try {
    // ★ 必须 await：部分模块的 runSelfCheck() 是 async
    //   （例如 features 层的集成适配需要动态 import 数据层）。
    //   漏掉 await 会把 Promise 当结果用 —— 表现为"0 项检查但判定失败"。
    const result = await mod.runSelfCheck()
    const checks = Array.isArray(result?.checks) ? result.checks : []
    if (!Array.isArray(result?.checks)) {
      return { ...entry, status: 'error', checks: [], error: 'runSelfCheck() 未返回 { checks: [] }' }
    }
    return {
      ...entry,
      status: result.passed && checks.every((check) => check.passed) ? 'pass' : 'fail',
      name: result?.name ?? entry.path,
      checks,
      error: null,
    }
  } catch (error) {
    return { ...entry, status: 'error', checks: [], error: `自检抛错：${error.message}` }
  }
}

function report(results, elapsedMs) {
  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  const totalChecks = results.reduce((sum, item) => sum + item.checks.length, 0)
  const failedChecks = results.reduce(
    (sum, item) => sum + item.checks.filter((check) => !check.passed).length, 0)

  if (AS_JSON) {
    console.log(JSON.stringify({
      ok: (counts.fail ?? 0) === 0 && (counts.error ?? 0) === 0 && (counts.missing ?? 0) === 0,
      elapsedMs,
      modules: results.map((item) => ({
        path: item.path, layer: item.layer, title: item.title, status: item.status,
        error: item.error, checks: item.checks,
      })),
      totals: { modules: results.length, checks: totalChecks, failedChecks, ...counts },
    }, null, 2))
    return
  }

  console.log('')
  console.log(paint(C.bold, '数字校园安全管理模式 · 模块自检报告'))
  console.log(paint(C.dim, '─'.repeat(72)))

  for (const layer of ['domain', 'data', 'features']) {
    const items = results.filter((item) => item.layer === layer)
    if (!items.length) continue
    console.log('')
    console.log(paint(C.cyan, `【${layer} 层】`))
    for (const item of items) {
      const badge = {
        pass: paint(C.green, ' PASS '),
        fail: paint(C.red, ' FAIL '),
        error: paint(C.red, 'ERROR '),
        missing: paint(C.yellow, ' 缺失 '),
        'no-selfcheck': paint(C.yellow, ' 无自检 '),
      }[item.status] ?? ' ???? '

      const verifiedMark = MODULES.find((entry) => entry.path === item.path)?.verified
        ? ''
        : paint(C.yellow, ' [待人工验收]')
      const count = item.checks.length ? paint(C.dim, ` (${item.checks.length} 项)`) : ''
      console.log(`${badge} ${item.path}${count}${verifiedMark}`)
      console.log(`        ${paint(C.dim, item.title)}`)
      if (item.error) console.log(`        ${paint(C.red, item.error)}`)

      const failed = item.checks.filter((check) => !check.passed)
      for (const check of failed) {
        console.log(`        ${paint(C.red, '✗')} ${check.label}`)
        console.log(`          ${paint(C.dim, check.detail)}`)
      }
      if (VERBOSE) {
        for (const check of item.checks.filter((c) => c.passed)) {
          console.log(`        ${paint(C.green, '✓')} ${check.label}`)
          console.log(`          ${paint(C.dim, check.detail)}`)
        }
      }
    }
  }

  console.log('')
  console.log(paint(C.dim, '─'.repeat(72)))
  const ok = (counts.fail ?? 0) === 0 && (counts.error ?? 0) === 0 && (counts.missing ?? 0) === 0
  const headline = ok
    ? paint(C.green, `全部通过：${results.length} 个模块 / ${totalChecks} 项检查`)
    : paint(C.red, `存在失败：${counts.fail ?? 0} 个模块失败、${counts.error ?? 0} 个模块报错、${counts.missing ?? 0} 个缺失`)
  console.log(`${headline}  ${paint(C.dim, `耗时 ${elapsedMs} ms`)}`)
  if (!ok) {
    console.log(paint(C.dim, `失败检查项合计 ${failedChecks} 项（加 --verbose 查看全部明细）`))
    const unverifiedFailing = results.filter((item) => item.status !== 'pass' &&
      !MODULES.find((entry) => entry.path === item.path)?.verified)
    if (unverifiedFailing.length && SKIP_UNVERIFIED) {
      console.log(paint(C.yellow, '（已按 --skip-unverified 跳过待验收模块）'))
    }
  }
  console.log('')
}

const started = Date.now()
const targets = SKIP_UNVERIFIED ? MODULES.filter((entry) => entry.verified) : MODULES
const results = []
for (const entry of targets) {
  results.push(await runModule(entry))
}
report(results, Date.now() - started)

const failed = results.some((item) =>
  item.status === 'fail' || item.status === 'error' || (item.status === 'missing' && !SKIP_UNVERIFIED))
process.exit(failed ? 1 : 0)
