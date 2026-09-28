/**
 * 零依赖打包器：把 src/ 下的 ESM 源码拼成一份浏览器可直接执行的脚本
 * ---------------------------------------------------------------------------
 * 为什么不用 esbuild / vite：
 *   本环境的 npm 安装被沙箱拦截（`spawn EPERM`），而验证工具链必须能跑起来。
 *   好在我们的模块依赖是**单向的**：组件 → `components/icons.js` 及其它域模块，
 *   组件**不直接 import React**（React 由 icons.js 的运行时注入）。
 *   于是可以在没有打包器的情况下完成拼接。
 *
 * 关键设计：**每个模块包一层 IIFE，只把 export 出来的名字暴露出去**。
 *   直接把所有模块平铺拼接会撞名 —— 实测 `ACTION_ICONS` 在 AlertCard 与
 *   WeatherStrip 里各有一份，平铺后直接 `SyntaxError: Identifier already declared`。
 *   IIFE + 解构既解决了撞名，也保住了模块边界。
 *
 * 用法：node dev/build-bundle.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const OUT_DIR = join(ROOT, 'dev')
const OUT = join(OUT_DIR, 'bundle.js')

/** 顺序即依赖顺序（被依赖者必须在前），按实际 import 关系拓扑排序 */
const MODULE_ORDER = [
  'components/icons.js',
  'domain/crowd.js',
  'domain/crowdRisk.js',
  'domain/alert.js',
  'domain/playbook.js',
  'domain/safetyStore.js',
  'data/weatherDataSource.js',
  'data/weatherActionMap.js',
  'data/safetyBaseline.js',
  'features/alerts/weatherIntegration.js',
  'features/alerts/EvidenceChain.jsx',
  'features/alerts/AlertCard.jsx',
  'features/alerts/WeatherStrip.jsx',
  'features/alerts/CrowdThresholdControl.jsx',
  'features/alerts/SafetyDashboard.jsx',
]

/**
 * 解析一个模块：抽出导出名，并剥掉 import / export 语句。
 *
 * 支持的写法（本项目里实际出现的全部形态）：
 *   export const X = ...        export function f() {}      export async function f() {}
 *   export { a, b }             export { a as b }
 *   import { x } from '...'     import x from '...'         import '...'
 *   import(\n  '...'\n)         动态 import 保留（浏览器原生支持）
 */
function parseModule(source) {
  const exports = new Set()
  const lines = source.split('\n')
  const out = []
  let skippingImport = false

  for (const line of lines) {
    const trimmed = line.trim()

    // ---- export { a, b as c } ----
    const exportList = trimmed.match(/^export\s*\{([^}]*)\}\s*;?$/)
    if (exportList) {
      for (const part of exportList[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) exports.add(name)
      }
      continue // 该行本身不需要保留（名字已在 module 作用域里）
    }

    // ---- export const / let / var / function / class / async function ----
    const decl = trimmed.match(/^export\s+(?:default\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/)
    if (decl) {
      exports.add(decl[2])
      out.push(line.replace(/^(\s*)export\s+(default\s+)?/, '$1'))
      continue
    }

    // ---- import ... from '...'（可能跨多行）----
    if (!skippingImport && /^import\s/.test(trimmed)) {
      const singleLine = /from\s+['"][^'"]+['"]\s*;?$/.test(trimmed) || /^import\s+['"][^'"]+['"]\s*;?$/.test(trimmed)
      if (!singleLine) skippingImport = true
      continue
    }
    if (skippingImport) {
      if (/from\s+['"][^'"]+['"]\s*;?$/.test(trimmed)) skippingImport = false
      continue
    }

    out.push(line)
  }

  return { code: out.join('\n'), exports: [...exports] }
}

const banner = `/**
 * 安全管理模式 · 浏览器验证包（自动生成，请勿手工编辑）
 * 生成命令：node dev/build-bundle.mjs
 * 生成时间：${new Date().toISOString()}
 *
 * 由 dev/build-bundle.mjs 从 src/ 拼接而成，用途是让组件在**真实浏览器**里
 * 跑起来，供无头截图与交互验证使用。它不是交付物的一部分；
 * 修改源码后需重新生成（或直接跑 node scripts/verify-ui.mjs 一键重建+截图）。
 */
(function () {
'use strict'
`

const chunks = [banner]
const included = []
const allExports = new Set()
/** 只有真正导出 runSelfCheck 的模块才登记 —— 否则会引用到不存在的别名（曾致 bundle 中断） */
const selfCheckModules = []

for (const rel of MODULE_ORDER) {
  const abs = join(SRC, rel)
  if (!existsSync(abs)) {
    console.error(`⚠ 跳过（不存在）：${rel}`)
    continue
  }

  const { code, exports } = parseModule(readFileSync(abs, 'utf8'))
  exports.forEach((name) => allExports.add(name))

  // ★ runSelfCheck 在每个模块里都叫同一个名字，直接拼进 window 会互相覆盖。
  //   用带模块前缀的别名导出，让验证页能把每个模块的自检都跑一遍。
  const aliasExports = exports.includes('runSelfCheck')
    ? [...exports.filter((name) => name !== 'runSelfCheck'), `runSelfCheck__${moduleVar(rel)}: runSelfCheck`]
    : exports

  chunks.push(`\n// ${'='.repeat(74)}\n// ${rel}\n// ${'='.repeat(74)}`)
  // ★ IIFE 隔离：模块内部的私有常量（如各自的 ACTION_ICONS）不会互相污染
  chunks.push(`var ${moduleVar(rel)} = (function () {`)
  chunks.push(code)
  chunks.push(`return { ${aliasExports.join(', ')} }`)
  chunks.push(`})()`)

  if (exports.length) {
    chunks.push(`var { ${exports.join(', ')} } = ${moduleVar(rel)}`)
  }
  if (exports.includes('runSelfCheck')) {
    // 顶层也需要一个可见的别名供 window 收集
    chunks.push(`var runSelfCheck__${moduleVar(rel)} = ${moduleVar(rel)}.runSelfCheck__${moduleVar(rel)}`)
    selfCheckModules.push(rel)
  }
  included.push(rel)
}

chunks.push(`
// ---- 暴露给验证页 ----
window.__SAFETY_MODULES__ = {
${[...allExports].filter((name) => !name.startsWith('runSelfCheck__')).sort((a, b) => a.localeCompare(b)).map((name) => `  ${name},`).join('\n')}
  __modules: [${included.map((rel) => `'${rel}'`).join(', ')}],
}

// ★ 各模块的 runSelfCheck 重名，用带前缀的别名收集，供浏览器端实跑自检。
//   只登记**确实导出 runSelfCheck** 的模块（如 components/icons.js 就没有）。
window.__SAFETY_SELFCHECK__ = {
${selfCheckModules.map((rel) => `  '${rel}': runSelfCheck__${moduleVar(rel)},`).join('\n')}
}
})()
`)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, chunks.join('\n'), 'utf8')

function moduleVar(rel) {
  return `__mod_${rel.replace(/[^A-Za-z0-9]/g, '_')}`
}

const bytes = statSync(OUT).size
console.log(`✅ 已生成 ${relative(ROOT, OUT)}`)
console.log(`   模块 ${included.length} 个 / 导出 ${allExports.size} 个 / ${(bytes / 1024).toFixed(1)} KB`)
for (const rel of included) console.log(`   · ${rel}`)
