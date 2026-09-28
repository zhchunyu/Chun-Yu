/**
 * 效果验证台（浏览器端逻辑）
 * ---------------------------------------------------------------------------
 * 用途：把 src/ 的组件在**真实浏览器**里跑起来 —— 真实 DOM、真实 CSS、
 *       真实交互，然后由 scripts/verify-ui.mjs 用无头 Chrome 截图回来肉眼核对。
 *
 * ★ 为什么不假装成 React：
 *   `components/icons.js` 的 `jsx()` 在没有 React 时会退化为
 *   **真实 DOM 元素创建**（document.createElement），所以这里拿到的是
 *   真元素、真样式、真布局 —— 截图看到的就是真实效果，不是示意图。
 *
 * 三个态势场景 + 一个数据自查面板：
 *   ① 常态      —— 人流关注 + 无预警
 *   ② 午间高峰  —— 人流高风险 + 预警卡 + 证据链 + 预案
 *   ③ 暴雨联动  —— 天气升档 + 封路 + 避雨模式 + 处置时效
 */

(function () {
  const M = window.__SAFETY_MODULES__

  if (!M) {
    document.getElementById('error').textContent = 'bundle.js 未加载：请先运行 node dev/build-bundle.mjs'
    return
  }

  // ---------------------------------------------------------------------------
  // 让 icons.js 的 jsx() 走真实 DOM 分支
  // ---------------------------------------------------------------------------
  M.installRuntime(makeDomRuntime(), null)

  function makeDomRuntime() {
    const SVG_NS = 'http://www.w3.org/2000/svg'
    const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text'])

    return {
      createElement(type, props, ...children) {
        // 函数组件（未渲染的嵌套组件）在这里递归求值，模拟 React 的行为
        if (typeof type === 'function') {
          return type({ ...(props ?? {}), children: children.length > 1 ? children : children[0] })
        }
        if (type === 'fragment') {
          const frag = document.createDocumentFragment()
          appendChildren(frag, children)
          return frag
        }

        const el = SVG_TAGS.has(type)
          ? document.createElementNS(SVG_NS, type)
          : document.createElement(type)

        for (const [key, value] of Object.entries(props ?? {})) {
          if (value == null || value === false) continue
          if (key === 'children') continue
          if (key === 'className') { el.setAttribute('class', String(value)); continue }
          if (key === 'style' && typeof value === 'object') {
            for (const [prop, val] of Object.entries(value)) {
              if (val == null) continue
              if (prop.startsWith('--')) el.style.setProperty(prop, String(val))
              else el.style[prop] = typeof val === 'number' ? `${val}px` : String(val)
            }
            continue
          }
          if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), value)
            continue
          }
          if (value === true) { el.setAttribute(key, ''); continue }
          el.setAttribute(key, String(value))
        }

        appendChildren(el, children)
        return el
      },
    }
  }

  function appendChildren(parent, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false || child === true) continue
      parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)))
    }
  }

  // ---------------------------------------------------------------------------
  // 演示数据与 Store
  // ---------------------------------------------------------------------------
  const T0 = new Date(2026, 8, 28, 11, 20, 0).getTime()
  const MIN = 60000
  const at = (m) => T0 + m * MIN

  const weatherSource = M.createWeatherSource({ now: () => new Date(at(0)) })

  const store = M.createSafetyStore({
    weatherSource,
    now: at(0),
    adjacency: {
      Canteen: ['Road-Axis', 'Plaza-Center', 'Canteen-2'],
      'Road-Axis': ['Canteen', 'Gate-Main'],
      'Plaza-Center': ['Canteen', 'Library'],
    },
    edgeIdResolver: (place) => ({
      第三食堂: 'outer_s2→outer_s3',
      亭兰图书馆: 'inner_e_s4→outer_s3',
      中央广场: 'axis_gate→outer_s2',
    }[place?.name] ?? null),
  })
  M.enableWeatherActions(store)

  const read = (id, name, kind, capacity, ratio, ts) => ({
    locationId: id, name, placeKind: kind,
    count: Math.round(ratio * capacity), capacity, effectiveCapacity: capacity,
    ratio, trend: null, ts,
  })

  // ---------------------------------------------------------------------------
  // 三个场景
  // ---------------------------------------------------------------------------
  const scenarios = {
    calm: {
      label: '① 常态（无人流告警）',
      build() {
        store.setWeather('clear', { now: at(0), autoAlert: false })
        store.ingestCrowdReadings([read('Canteen', '第三食堂', 'dining', 396, 0.42, at(0))], { now: at(0) })
        // ★ 常态下也放一条**待核实**的安全类上报：
        //   它低于安全类阈值（0.75），进人工审核队列、不响预警、不上图 ——
        //   这正是"常态"该有的样子：**信息在流转，但没有风险被触发**。
        //   同时它让常态页面也有一张卡可看，避免截图显得空。
        store.ingestEvent({
          id: 'e-fallen-bike', type: 'safety', title: '实验楼后面的路灯坏了两盏', locationId: 'Library',
          ts: at(1), placeKind: 'teaching',
          ai: {
            credibility: {
              score: 0.55,
              threshold: 0.75,
              passed: false,
              base: 0.4,
              source: 0.05,
              crowd: 0,
              commonSense: 0.05,
              text: 0.05,
              breakdown: [
                { key: 'base', label: '基础分', value: 0.4, detail: '上报事件的最低可信度起点' },
                { key: 'source', label: '位置来源', value: 0.05, detail: 'manual 选点：−0.05；本条为地图点选上报' },
                { key: 'crowd', label: '群体佐证', value: 0, detail: '仅 1 人独立上报，无群体佐证加分' },
                { key: 'commonSense', label: '常识一致性', value: 0.05, detail: '锚点「亭兰图书馆」真实存在，通过存在性校验' },
                { key: 'text', label: '文本质量', value: 0.05, detail: '描述 12 字，具体程度一般' },
              ],
            },
          },
        }, { now: at(1) })
      },
    },

    peak: {
      label: '② 午间高峰（人流风控 + 证据链）',
      build() {
        store.setWeather('clear', { now: at(0), autoAlert: false })
        const readings = [0.62, 0.74, 0.83, 0.91, 0.94, 0.96]
          .map((r, i) => read('Canteen', '第三食堂', 'dining', 396, r, at(i)))
        store.ingestCrowdReadings(readings, { now: at(5) })

        // 两条上报：安全类低可信度（待核实）与通行类高可信度（已发布）
        store.ingestEvent({
          id: 'e-railing', type: 'safety', title: '湖边挑台护栏松动', locationId: 'Library', ts: at(8),
          placeKind: 'teaching', ai: { credibility: { score: 0.55, threshold: 0.75 } },
        }, { now: at(8) })
        store.ingestEvent({
          id: 'e-truck', type: 'traffic', title: '三食堂门口停了辆卡车，无法通行', locationId: 'Canteen', ts: at(8),
          ai: { credibility: { score: 0.86, threshold: 0.65 } },
        }, { now: at(8) })
      },
    },

    storm: {
      label: '③ 暴雨联动（封路 + 避雨模式 + 处置时效）',
      build() {
        scenarios.peak.build()
        // 天气升档 → 自动生成预警
        store.setWeather('rainstorm_red', { now: at(10) })
        const weatherAlert = store.getState(at(10)).alerts.find((a) => a.kind === 'weather')
        if (weatherAlert) store.runPlaybook(weatherAlert, { now: at(11) })
        // 规则表驱动的动作也跑一遍（与预案共用同一份封路集合）
        store.runWeatherActions(weatherSource.getCurrent(), { now: at(12), level: 'high' })
        // 处置时效：让一条预警走完派单→归档
        const truck = store.getState(at(12)).alerts.find((a) => a.eventId === 'e-truck')
        if (truck) {
          store.runPlaybook(truck, { now: at(13) })
          store.advanceAlertState(truck.id, 'resolved', { at: at(18), actor: '保卫处' })
          store.advanceAlertState(truck.id, 'closed', { at: at(20), actor: '系统' })
        }
      },
    },
  }

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------
  const root = document.getElementById('app')
  // 支持 ?scenario=calm|peak|storm —— 供 scripts/verify-ui.mjs 指定场景截图
  const requested = new URLSearchParams(location.search).get('scenario')
  let current = requested && scenarios[requested] ? requested : 'peak'

  async function render() {
    const scenario = scenarios[current]
    scenario.build()

    const now = at(20)
    const state = store.getState(now)
    const analysis = M.analyzeWeather(weatherSource.getCurrent())
    const briefing = M.buildSafetyBriefing(state, analysis)

    // 自检是异步的（有个模块的 runSelfCheck 返回 Promise），先算完再上树
    const selfCheckPanel = await renderSelfCheck()

    root.replaceChildren(
      renderScenarioBar(),
      section('天气与应急联动', [
        M.WeatherStrip({
          scenario: weatherSource.getCurrent(),
          scenarios: weatherSource.listScenarios(),
          analysis,
          levelChange: weatherSource.history().at(-1) ?? null,
          onChangeScenario: (id) => { weatherSource.setScenario(id); store.setWeather(id, { now, autoAlert: false }); void render() },
        }),
      ]),
      section('安全态势大屏', [
        M.SafetyDashboard({ state, briefing: briefing.text, briefingMode: 'template' }),
      ]),
      row2(
        section('预警卡片（含一键预案与证据链）', buildAlertCards(state, now)),
        section('人流阈值与容量口径', [
          M.CrowdThresholdControl({
            thresholds: M.DEFAULT_THRESHOLDS,
            onChange: () => {},
            weather: weatherSource.getCurrent(),
            places: [
              { locationId: 'Canteen', name: '第三食堂', placeKind: 'dining', place: M.PLACE_CAPACITY.Canteen },
              { locationId: 'Playground', name: '东操场', placeKind: 'sports', place: M.PLACE_CAPACITY.Playground },
              { locationId: 'Library', name: '亭兰图书馆', placeKind: 'teaching', place: M.PLACE_CAPACITY.Library },
            ],
          }),
        ]),
      ),
      section('数据自查（模块自检结果 —— 在浏览器里实跑）', [selfCheckPanel]),
    )

    // 供 --dump-dom 判断"渲染是否已完成"
    window.__RENDER_DONE__ = true
    document.title = `安全管理模式 · 效果验证台 · ${scenario.label}`

    // ★ 自证：统计**折叠状态下看不到**的内容是否真的被渲染了。
    //   无头 `--dump-dom` 抓不到 <details> 折叠子树，所以这部分改用
    //   浏览器端计数来证明，并把结果写进 DOM 供外部断言读取。
    const probe = document.createElement('div')
    probe.id = 'render-probe'
    probe.hidden = true
    probe.textContent = JSON.stringify({
      scenario: current,
      evidenceRows: document.querySelectorAll('.evidence-row').length,
      playbookSteps: document.querySelectorAll('.playbook-step').length,
      timelineRows: document.querySelectorAll('.timeline-row').length,
      alertCards: document.querySelectorAll('.alert-card').length,
      dispatchRows: document.querySelectorAll('.dispatch-row').length,
      selfCheckPassed: document.querySelectorAll('.selfcheck-badge.is-pass').length,
      selfCheckFailed: document.querySelectorAll('.selfcheck-badge.is-fail').length,
    })
    const previous = document.getElementById('render-probe')
    if (previous) previous.remove()
    document.body.appendChild(probe)
  }

  function buildAlertCards(state, now) {
    const cards = []
    for (const alert of state.alerts.slice(0, 3)) {
      const planned = store.planForAlert(alert, { now })
      cards.push(M.AlertCard({
        alert,
        playbook: planned.instance,
        now,
        //「待核实」的卡默认展开证据链 —— 它本来就是要给人核查的
        expanded: alert.state === 'verifying',
        onExecutePlaybook: (instance) => { store.runPlaybook(alert, { now }); void render() },
        onUndoPlaybook: () => { store.undoPlaybook(alert.id, { now }); void render() },
        onAdvance: (target, next) => {
          store.advanceAlertState(target.id, next, { at: now, actor: '管理者' })
          void render()
        },
      }))
    }
    if (!cards.length) cards.push(emptyNote('当前无预警'))
    return cards
  }

  function renderScenarioBar() {
    const bar = document.createElement('div')
    bar.className = 'scenario-bar'
    const label = document.createElement('span')
    label.className = 'scenario-bar__label'
    label.textContent = '切换态势：'
    bar.appendChild(label)

    for (const [key, scenario] of Object.entries(scenarios)) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `scenario-btn${key === current ? ' is-active' : ''}`
      btn.textContent = scenario.label
      btn.addEventListener('click', () => { current = key; render() })
      bar.appendChild(btn)
    }
    return bar
  }

  /**
   * 在浏览器里实跑各模块自检。
   *
   * ★ 注意 `features/alerts/weatherIntegration.js` 的 `runSelfCheck()` 是 **async**
   *   （它内部要动态 import 数据层）。这里必须 await，否则拿到的是 Promise，
   *   会被判成"未返回 checks"而误报失败。同时把渲染推迟到全部完成之后，
   *   保证 --dump-dom 抓到的是最终态。
   */
  async function renderSelfCheck() {
    const wrap = document.createElement('div')
    wrap.className = 'selfcheck'
    const targets = window.__SAFETY_SELFCHECK__ ?? {}
    const entries = Object.entries(targets)

    if (!entries.length) {
      wrap.appendChild(emptyNote('未收集到自检目标'))
      return wrap
    }

    let pass = 0
    for (const [name, fn] of entries) {
      const row = document.createElement('div')
      row.className = 'selfcheck-row'
      const badge = document.createElement('span')
      const label = document.createElement('span')
      label.className = 'selfcheck-name'
      label.textContent = name
      const detail = document.createElement('span')
      detail.style.color = '#8fa3b8'

      let result = null
      try {
        result = typeof fn === 'function' ? await fn() : null
      } catch (error) {
        result = { passed: false, checks: [], error: error.message }
      }

      badge.className = `selfcheck-badge ${result?.passed ? 'is-pass' : 'is-fail'}`
      badge.textContent = result?.passed ? 'PASS' : 'FAIL'
      detail.textContent = result?.error
        ? `运行失败：${result.error}`
        : `${result?.checks?.length ?? 0} 项检查`
      if (result?.passed) pass += 1

      row.append(badge, label, detail)
      wrap.appendChild(row)
    }

    const summary = document.createElement('div')
    summary.className = `selfcheck-summary ${pass === entries.length ? 'is-ok' : 'is-bad'}`
    summary.textContent = `${pass} / ${entries.length} 个模块在浏览器里实跑通过`
    wrap.appendChild(summary)
    return wrap
  }

  function section(title, children) {
    const el = document.createElement('section')
    const h = document.createElement('h2')
    h.textContent = title
    el.appendChild(h)
    for (const child of children.flat()) {
      if (child) el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)))
    }
    return el
  }

  function row2(left, right) {
    const el = document.createElement('div')
    el.className = 'row row--2'
    el.append(left, right)
    return el
  }

  function emptyNote(text) {
    const el = document.createElement('div')
    el.className = 'alert-timeline__empty'
    el.textContent = text
    return el
  }

  // render() 现在是 async（内含 await 的自检），显式处理 rejection，
  // 否则失败只会静默停在半渲染状态
  render().catch((error) => {
    window.__ERRORS__?.push(`render 失败：${error.message}`)
    const box = document.getElementById('error')
    if (box) box.textContent = `render 失败：${error.message}\n${error.stack ?? ''}`
  })
})()

