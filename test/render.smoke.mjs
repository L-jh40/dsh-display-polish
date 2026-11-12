/**
 * dsh-display-polish 冒烟测试（真实 React 18 + jsdom）。
 * 覆盖：会话统计 pill（官方口径两位小数 / 近 100% 不进位）、每轮合并 pill
 * （chip 文案「本轮 X 元」、提供方与模型各一行只取生效那条、分桶金额、推理单独一行）、
 * 用时 pill（总-分 " -" 结构 + 其他 + 主机端 TTFT/TPS）、注册重试、CSS 覆盖选择器。
 *
 * 运行：node test/render.smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const RESOLVERS = [
  import.meta.url,
  join(here, '..', '..', 'dsh-balance-meter', 'node_modules', 'package.json'),
  join(here, '..', 'node_modules', 'package.json'),
  'C:/Users/lin/gomoku_go_hybrid/dsh-balance-meter/dsh-balance-meter-master/package.json',
]
const require = ((cache) => (name) => {
  if (cache.has(name)) return cache.get(name)
  const failures = []
  for (const base of RESOLVERS) {
    try { const mod = createRequire(base)(name); cache.set(name, mod); return mod } catch (error) { failures.push(base + ': ' + error.code) }
  }
  throw new Error('cannot resolve ' + name + ' — ' + failures.join(' | '))
})(new Map())

const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1:3080/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) {
  if (dom.window[key] === undefined) continue
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = require('react-dom/test-utils')
const icon = (name) => function Icon() { return React.createElement('i', { 'data-icon': name }) }
const primitives = { IconGaugeOutline16: icon('gauge'), IconDatabaseOutline16: icon('database'), IconClockOutline16: icon('clock') }

const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
const requireShim = (id) => {
  if (id === 'react') return React
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  // 弹层用 createPortal 挂到 body：测试里直接内联渲染就够了（断言只看文本/结构）。
  if (id === 'react-dom') return { createPortal: (node) => node }
  throw new Error('unexpected require: ' + id)
}
const loadPlugin = () => {
  let captured = null
  globalThis.window.__ModuleLoader__ = { load: (entry) => { captured = entry } }
  ;(0, eval)(source)
  return captured.factory(requireShim)
}
const plugin = loadPlugin()
/** 插件源码（断言 CSS/几何实现细节时用）。 */


const cssText = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/*
 * 组件现在自带语言（useTranslate，默认中文，弹层底部可切中/EN），不再读 props.t：
 * 这里给一个「原样返回 key」的占位，若哪天又有组件依赖宿主 t，断言会因为出现 stats.* 而失败。
 */
const t = (key) => key

const checks = []
const check = (label, ok) => checks.push([label, ok])
const pump = async () => { await act(async () => { await Promise.resolve() }) }
const flush = async () => { for (let i = 0; i < 10; i += 1) await pump() }
const render = async (element) => {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(element) })
  await flush()
  return { host, root }
}
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }); await flush() }

const makeCtx = (registrations, { failFirst = 0, occupants = [{ id: 'stats', priority: 0 }] } = {}) => {
  let failures = failFirst
  return {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    locale: { register: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ current: 'session-smoke' }), subscribe: () => () => {} } },
    inject: (deps, callback) => callback({
      effect: (fn) => { fn() },
      slots: {
        // 0.2.0 只有 stats；0.2.1 起拆成 activity + usage（插件按占位者探测决定注册哪套 id）。
        snapshot: (name) => name === 'conversation.composer.dock' ? [{ key: name, occupants }] : [],
        register: (options, component) => {
          if (failures > 0) { failures -= 1; throw new Error('slot not declared (test)') }
          registrations.push({ options, component })
          return () => {}
        },
      },
    }),
  }
}

// ---------- 注册 ----------
const registrations = []
plugin.apply(makeCtx(registrations))
console.log('registered:', registrations.map((r) => r.options.name + (r.options.id !== undefined ? '#' + r.options.id : '#' + r.options.key)).join(', '))
check('注册 dock#stats(priority -1) + assistant-actions#turn-cost + turnTail 兜底', registrations.length === 3 && registrations[0].options.id === 'stats' && registrations[0].options.priority === -1 && registrations[1].name === undefined && registrations[1].options.name === 'conversation.chat.assistant-actions' && registrations[1].options.id === 'turn-cost' && registrations[2].options.name === 'conversation.chat.turnTail' && registrations[2].options.id === 'turn-pills-fallback')

// 0.2.1 的 dock 是两个条目：探测到 activity 时要在 activity / usage 上各注册一个 -1，否则官方 pill 会重现。
const splitRegistrations = []
loadPlugin().apply(makeCtx(splitRegistrations, { occupants: [{ id: 'activity', priority: 0 }, { id: 'usage', priority: 0 }] }))
check('dock 0.2.1：按 activity / usage 两个 id 各注册 priority -1', splitRegistrations.length === 4 && splitRegistrations[0].options.id === 'activity' && splitRegistrations[1].options.id === 'usage' && splitRegistrations[0].options.priority === -1 && splitRegistrations[1].options.priority === -1 && splitRegistrations[0].options.order === 0 && splitRegistrations[1].options.order === 1)

const retryRegistrations = []
loadPlugin().apply(makeCtx(retryRegistrations, { failFirst: 2 }))
await new Promise((resolve) => setTimeout(resolve, 900))
check('槽位尚未声明时按 250ms 重试注册', retryRegistrations.length === 3)

// ---------- 会话统计 pill ----------
const usage = { uncachedInputTokens: 100, cacheReadTokens: 9900, cacheWriteTokens: 0, outputTokens: 500 }
const stats = { turns: 2, steps: 3, llmMs: 5000, toolMs: 1000, ttftMs: 800, ttftSteps: 2, decodeMs: 4000, decodeTokens: 200 }
globalThis.fetch = async (url) => {
  if (String(url).startsWith('/api/balance/turns')) return { ok: true, json: async () => ({ ok: true, totals: { waitMs: 4200 }, turns: [] }) }
  return { ok: true, json: async () => ({ ok: false }) }
}
const statsComp = registrations.find((r) => r.options.id === 'stats').component
// ---------- DESKTOP-LIKE：无客户端 projection / 无节点数据，只有主机端 /turns ----------
{
  const hostPayload = {
    ok: true,
    totals: { turns: 3, steps: 81, llmMs: 665753, toolMs: 73556, waitMs: 0, askMs: 0, uncachedInputTokens: 5424, cacheReadTokens: 8883840, cacheWriteTokens: 0, outputTokens: 7234, cost: 0.19 },
    turns: [
      { turn: 3, model: 'deepseek-v4.1-flash-expires-on-0910', modelName: 'DeepSeek-V4.1-Flash-Expires-On-0910', steps: 4, runMs: 83000, totalTokens: 1000, llmMs: 12000, toolMs: 45000, waitMs: 3000, askMs: 0, ttftMs: 1234, tokensPerSecond: 42.5, cost: 0.1976,
        messageIds: ['m-1'],
        detail: { uncachedInputTokens: 5424, cacheReadTokens: 8883840, cacheWriteTokens: 0, outputTokens: 7234, uncachedInputCost: 0.0145, cacheReadCost: 0.1777, outputCost: 0.0054 },
        stepsDetail: [{ step: 1, tools: [{ name: 'run_code', count: 1 }], subTools: [{ name: 'pwsh', count: 2 }], cost: 0.0156 }] },
    ],
    modelNames: { 'deepseek-v4.1-flash-expires-on-0910': 'DeepSeek-V4.1-Flash-Expires-On-0910' },
    providerNames: { 'deepseek-official': 'DeepSeek' },
    modelProviders: { 'deepseek-v4.1-flash-expires-on-0910': 'deepseek-official' },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('/api/balance/turns')) return { ok: true, json: async () => hostPayload }
    return { ok: true, json: async () => ({ ok: false }) }
  }
  const dock = await render(React.createElement(statsComp, {
    t, sessionId: undefined,
    useChat: () => undefined,
    useSession: (selector) => selector({ sessionId: 'session-desktop' }),
    useProjection: (key) => (key === 'tokenUsage' ? usage : undefined),
  }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  console.log('DESKTOP-LIKE PILLS:', JSON.stringify(dock.host.textContent))
  check('桌面版兜底：只有主机端 totals 时也渲染模型/工具用时', dock.host.textContent.includes('模型') && dock.host.textContent.includes('工具'))
  check('桌面版兜底：用量侧仍显示缓存命中', dock.host.textContent.includes('缓存命中'))

  const turn = await render(React.createElement(registrations.find((r) => r.options.id === 'turn-cost').component, {
    t, messageId: 'm-1',
    useChat: () => ({ data: undefined, location: undefined }),
    useSession: (selector) => selector({ sessionId: 'session-desktop' }),
    useProjection: () => undefined,
  }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  console.log('DESKTOP-LIKE TURN:', JSON.stringify(turn.host.textContent))
  check('桌面版兜底：每轮 pill 由主机端数据渲染出金额', turn.host.textContent.includes('本轮 0.1976 元'))
  globalThis.fetch = realFetch
}

const pills = await render(React.createElement(statsComp, {
  t, sessionId: 'session-dock',
  useChat: (selector) => selector({ legacy: { nodes: [] } }),
  useProjection: (key) => (key === 'tokenUsage' ? usage : stats),
}))
const pillsText = pills.host.textContent
console.log('PILLS TEXT:', JSON.stringify(pillsText))
check('会话缓存命中：官方计算方式 + 两位小数（99.00%）', pillsText.includes('缓存命中 99.00%'))
check('会话内联用短标签（模型/工具/等待，分钟粒度）', pillsText.includes('模型 1分') && pillsText.includes('工具 1分') && pillsText.includes('等待 1分') && !pillsText.includes('模型用时'))
check('用量 pill 缓存命中固定可见', cssText.includes('.SSPv_pillFixed{flex:none}') && cssText.includes('cls.pillFixed'))
check('会话行腾出空间：轮数步数不再占用内联', !pillsText.includes('2 轮 3 步'))
// 点开时间 pill：官方四项 + 等待，且轮数/步数移到弹层标题里（信息不丢）
const dockPillButtons = pills.host.querySelectorAll('button.SSPv_pill')
await click(dockPillButtons[0])
const dockPanel = pills.host.querySelector('[data-session-stats-details]')
const dockPanelText = dockPanel?.parentElement?.textContent ?? ''
console.log('SESSION PANEL:', JSON.stringify(dockPanelText))
check('会话时间弹层含官方四项 + 等待用户选择 + 轮数步数标题', ['模型用时', '工具调用用时', '等待用户选择', '首 token 平均（TTFT）', '输出速度（TPS）', '2 轮 3 步'].every((k) => dockPanelText.includes(k)))

const nearUsage = { uncachedInputTokens: 1, cacheReadTokens: 999999, cacheWriteTokens: 0, outputTokens: 10 }
const near = await render(React.createElement(statsComp, {
  t, sessionId: 'session-near',
  useChat: (selector) => selector({ legacy: { nodes: [] } }),
  useProjection: (key) => (key === 'tokenUsage' ? nearUsage : stats),
}))
const nearText = near.host.textContent
check('部分命中不显示 100.00%（自动加精度 99.9999%）', nearText.includes('缓存命中 99.9999%') && !nearText.includes('100.00%'))

// ---------- 每轮：合并 pill ----------
const turnLocation = { turn: 2, start: { time: 1000 }, end: { time: 83000 } }
const tailNode = {
  kind: 'turn-tail', key: 'node-2',
  location: { kind: 'turn', turn: turnLocation },
  data: {
    turn: 2, seq: 42,
    closing: { finalNode: { seq: 42, messageId: 'msg-2' } },
    tokenUsage: {
      uncachedInputTokens: 5424, cacheReadTokens: 8883840, cacheWriteTokens: 0, outputTokens: 7234,
      totalTokens: 8896498, reasoningTokens: 2116,
      routes: [
        { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        { provider: 'deepseek-official', model: 'deepseek-v4.1-flash-expires-on-0910' },
      ],
    },
    // 故意不带 ttftMs / tokensPerSecond：验证是主机端（完整日志口径）补齐的
  },
}
const hostTurn = {
  turn: 2, cost: 0.1976, model: 'deepseek-v4.1-flash-expires-on-0910',
  modelName: 'DeepSeek-V4.1-Flash-Expires-On-0910',
  llmMs: 12000, toolMs: 45000, waitMs: 3000, askMs: 20000, ttftMs: 1234, tokensPerSecond: 42.5,
  detail: { uncachedInputTokens: 5424, cacheReadTokens: 8883840, outputTokens: 7234, uncachedInputCost: 0.0145, cacheReadCost: 0.1777, outputCost: 0.0054 },
  stepsDetail: [
    { step: 1, tools: [{ name: 'run_code', count: 1 }], subTools: [{ name: 'pwsh', count: 2 }, { name: 'read', count: 1 }], cost: 0.0156,
      uncachedInputTokens: 5424, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 120 },
    { step: 2, tools: [{ name: 'run_code', count: 1 }], subTools: [{ name: 'pwsh', count: 1 }], cost: 0.0161,
      uncachedInputTokens: 300, cacheReadTokens: 9000, cacheWriteTokens: 0, outputTokens: 80 },
    // 纯思考步（这一步没有工具调用）：按步明细里也必须出现，并带 4 个 token 桶。
    // 它的 cacheRead(2000) < 上一步 prompt(9300) → 旧对话缓存失效 7300 tok。
    { step: 3, tools: [], cost: 0.01,
      uncachedInputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 60 },
  ],
}
globalThis.fetch = async (url) => {
  if (String(url).startsWith('/api/balance/turns')) {
    // 目录表在响应顶层（主机端就是这么给的），每轮另有 modelName。
    return { ok: true, json: async () => ({
      ok: true,
      totals: { waitMs: 0, askMs: 20000 },
      turns: [hostTurn],
      modelNames: { 'deepseek-v4.1-flash-expires-on-0910': 'DeepSeek-V4.1-Flash-Expires-On-0910' },
      providerNames: { 'deepseek-official': 'DeepSeek' },
    }) }
  }
  return { ok: true, json: async () => ({ ok: false }) }
}
// 按真实结构渲染：row > div[data-slot] > 插件 pill
const row = dom.window.document.createElement('div')
row.className = 'xzv4MW_actions TS9iAW_actions'
const slot = dom.window.document.createElement('div')
slot.setAttribute('data-slot', 'conversation.chat.assistant-actions')
slot.style.display = 'contents'
row.appendChild(slot)
dom.window.document.body.appendChild(row)
const turnComp = registrations.find((r) => r.options.id === 'turn-cost').component
const turnRoot = createRoot(slot)
await act(async () => {
  turnRoot.render(React.createElement(turnComp, {
    t, messageId: 'msg-2', sessionId: 'session-turn',
    useChat: (selector) => selector({ nodes: { values: () => [tailNode] } }),
  }))
})
await flush()
const turnText = slot.textContent
console.log('TURN CHIPS:', JSON.stringify(turnText))
const triggers = slot.querySelectorAll('button.SSPv_trigger')
check('每轮两枚 pill', triggers.length === 2)
check('chip 文案为「本轮 0.1976 元」', turnText.includes('本轮 0.1976 元'))
check('用时 pill 内联本轮总用时', turnText.includes('用时 1分22秒'))
check('插件给收尾行打上标记（CSS 才隐藏官方 pill）', row.getAttribute('data-statsline-turn-pills') === '')

await click(triggers[0])
// 按步明细是「下一帧」才挂上的（先让面板出现，再建几百行），等一帧再断言
await new Promise((resolve) => setTimeout(resolve, 80))
await flush()
const usageBox = slot.querySelector('[data-turn-usage-details]')?.parentElement
const usageText = usageBox?.textContent ?? ''
console.log('TURN USAGE PANEL:', JSON.stringify(usageText))
check('弹层标题值=精确总 tok', usageText.includes('本轮用量（0.1976 元）8,896,498 tok'))
check('提供方/模型各一行且只显示生效那条', usageText.includes('提供方DeepSeek') && !usageText.includes('deepseek-v4-flash'))
check('模型显示目录里的名称而不是路由 id', usageText.includes('模型DeepSeek-V4.1-Flash-Expires-On-0910') && !usageText.includes('deepseek-v4.1-flash-expires-on-0910'))
check('每轮缓存命中两位小数（99.94%）', usageText.includes('缓存命中率99.94%'))
check('分桶带元金额与 token', usageText.includes('未缓存输入（0.0145 元）5,424 tok') && usageText.includes('缓存输入（0.1777 元）8,883,840 tok') && usageText.includes('输出（0.0054 元）7,234 tok'))
check('输出行不再内联「其中推理」', !usageText.includes('其中推理'))
check('推理单独一行（" -" 前缀 + 按占比折算金额）', usageText.includes('-推理输出（0.0016 元） 2,116 tok'))
check('工具调用金额与明细', usageText.includes('工具调用所在步花费（0.0317 元）') && usageText.includes('运行代码 ×2 → 0.0317 元'))
check('子工具按层级显示（工具下面的 pwsh / 读取）', usageText.includes('pwsh ×3 → 0.0265 元') && usageText.includes('读取 ×1 → 0.0052 元'))
check('每步子工具也按层级显示', usageText.includes('-pwsh ×2') && usageText.includes('-读取 ×1'))
/* ---- 1.1 按步：每步只留「金额 + 缓存命中率」，4 个桶只进原始数据 ---- */
check('按步明细每步都出现（含没有工具调用的纯思考步）', usageText.includes('第1步') && usageText.includes('第2步') && usageText.includes('第3步'))
check('步头格式：第1步（0.0156 元，0.0%）', usageText.includes('第1步（0.0156 元，0.0%）'))
check('步头缓存命中率按本步 prompt 算（第2步 96.8%）', usageText.includes('第2步（0.0161 元，96.8%）'))
check('4 个 token 桶不再写进按步行（只在原始数据里）', !usageText.includes('未缓存 5,424') && !usageText.includes('缓存读 9,000'))
const stepsEl = slot.querySelector('[data-turn-steps] .SSPv_steps')
const stepNos = stepsEl === null ? [] : [...stepsEl.children].filter((el) => el.classList.contains('SSPv_stepNo'))
check('步号单独成列、顶格左对齐（列宽按最宽步号撑开 → 括号对齐）', stepNos.length === 3 && stepNos[0].textContent === '第1步' && cssText.includes('.SSPv_steps{grid-template-columns:max-content minmax(0,1fr)') && cssText.includes('.SSPv_stepNo{color:var(--dsw-alias-label-secondary);text-align:left'))
/* ---- 1.2 上下文里未命中缓存的旧对话 + 额外金额 ---- */
check('上下文缓存（估算）区块出现', usageText.includes('上下文缓存（估算）') && usageText.includes('旧对话缓存失效'))
check('首步未缓存输入当上下文基准，并给出「比命中多付」', usageText.includes('首步未缓存输入（基准）') && usageText.includes('5,424 tok（比全部命中缓存多付 0.0144 元）'))
check('旧对话缓存失效 = 上一步 prompt − 本步缓存读（7,300 tok → 0.0194 元）', usageText.includes('7,300 tok（额外 0.0194 元）'))
/* ---- 原始数据：整理过的按步 token 桶（不是 JSON / 代码块） ---- */
const rawToggle = usageBox.querySelector('[data-raw-toggle]')
check('弹层底部有「原始数据」按钮', rawToggle !== null && rawToggle.textContent.includes('原始数据'))
await click(rawToggle)
const rawBlock = usageBox.querySelector('[data-turn-raw]')
check('原始数据是整理过的按步令牌清单，不是 JSON', rawBlock !== null && !rawBlock.textContent.includes('uncachedInputTokens') && rawBlock.textContent.includes('未缓存 5,424 · 缓存读 0 · 缓存写 0 · 输出 120'))
check('原始数据每步一行，含没有工具调用的纯思考步', rawBlock !== null && rawBlock.textContent.includes('未缓存 300 · 缓存读 9,000 · 缓存写 0 · 输出 80') && rawBlock.textContent.includes('未缓存 1,000 · 缓存读 2,000 · 缓存写 0 · 输出 60'))
check('原始数据的步号与面板行共用同一列（第1步…第3步）', rawBlock !== null && ['第1步', '第2步', '第3步'].every((k) => rawBlock.textContent.includes(k)))
check('面板里每一步的 DOM 也带 data-step（可在 devtools 里定位）', slot.querySelector('[data-turn-steps] [data-step="1"]') !== null)
await click(usageBox.querySelector('[data-raw-toggle]'))
check('再点一次收起原始数据', usageBox.querySelector('[data-turn-raw]') === null)
/* 语言开关已从每轮弹层挪到「会话统计」弹层（每轮弹层可能有上百步，越轻越好） */
check('每轮用量弹层里不再放语言开关', usageBox.querySelector('[data-plugin-lang]') === null)
const langGroup = pills.host.querySelector('[data-plugin-lang]')
check('会话统计弹层底部有中/EN 语言开关，默认中文', langGroup !== null && langGroup.getAttribute('data-plugin-lang') === 'zh')
await click(langGroup.querySelectorAll('button')[1])
const enText = slot.querySelector('[data-turn-usage-details]')?.parentElement?.textContent ?? ''
check('切到 EN：Step 1 (0.0156 CNY, 0.0%)', enText.includes('Step 1 (0.0156 CNY, 0.0%)') && !enText.includes('第1步'))
check('切到 EN 时工具名保持原名（不做中文翻译）', enText.includes('run_code ×1'))
await click(pills.host.querySelector('[data-plugin-lang]').querySelectorAll('button')[0])
const zhBack = slot.querySelector('[data-turn-usage-details]')?.parentElement?.textContent ?? ''
check('切回中文，且选择写进 localStorage', zhBack.includes('第1步') && dom.window.localStorage.getItem('dsh-display-polish:lang') === 'zh')
check('弹层里没有漏翻的 key', !usageText.includes('stats.') && !zhBack.includes('stats.'))
check('弹层底边固定在触发 pill 上方（PANEL_GAP）', cssText.includes('const PANEL_GAP = 8') && cssText.includes('const bottom = Math.max(PANEL_MARGIN, window.innerHeight - rect.top + PANEL_GAP)'))

await click(triggers[0])
await click(triggers[1])
const timeBox = slot.querySelector('[data-turn-time-details]')?.parentElement
const timeText = timeBox?.textContent ?? ''
console.log('TURN TIME PANEL:', JSON.stringify(timeText))
check('用时弹层总-分结构（" -" 前缀）', timeText.includes('本轮总用时1分22秒') && timeText.includes('-模型用时12秒') && timeText.includes('-工具调用用时45秒') && timeText.includes('-等待用户选择3秒'))
check('询问用时单独一行（不并入工具调用）', timeText.includes('-询问用时20秒'))
check('补上「其他」让分项与总用时对得上（已扣除询问用时）', timeText.includes('-其他2秒'))
check('首 token / TPS 来自主机端（不受加载窗口限制）', timeText.includes('-输出速度（TPS）43 tok/s') && timeText.includes('-首 token 用时（TTFT）1.2秒'))

// ---------- CSS 覆盖选择器 ----------
const fixture = dom.window.document.createElement('div')
fixture.innerHTML = [
  '<div data-turn-tail="2">',
  '  <div class="xzv4MW_actions TS9iAW_actions" data-statsline-turn-pills="">',
  '    <span class="Q51KRG_root"><button aria-haspopup="dialog">官方用量</button></span>',
  '    <span class="Q51KRG_root"><button aria-haspopup="dialog">官方用时</button></span>',
  '    <span class="xzv4MW_timeEnd">12:34</span>',
  '    <div data-slot="conversation.chat.assistant-actions" style="display:contents">',
  '      <span class="SSPv_root"><button class="SSPv_trigger" aria-haspopup="dialog">本轮 0.4 元</button></span>',
  '    </div>',
  '  </div>',
  '  <div><div data-presented-file="true"><span class="abc_description">总结</span></div></div>',
  '</div>',
].join('')
dom.window.document.body.appendChild(fixture)
const hiddenByMarker = fixture.querySelectorAll("[data-turn-tail] div[class$='_actions'][data-statsline-turn-pills] > span[class$='_root']:not(.SSPv_root)")
const hiddenByHas = fixture.querySelectorAll("[data-turn-tail] div[class$='_actions']:has([data-slot='conversation.chat.assistant-actions'] span.SSPv_root) > span[class$='_root']:not(.SSPv_root)")
const myOrder = fixture.querySelector("[data-turn-tail] div[class$='_actions'] [data-slot='conversation.chat.assistant-actions'] span.SSPv_root")
const descriptions = fixture.querySelectorAll("[data-presented-file] span[class$='_description']")
console.log('hiddenByMarker:', hiddenByMarker.length, 'hiddenByHas:', hiddenByHas.length, 'descriptions:', descriptions.length)
check('CSS 只隐藏官方两枚 pill（标记写法 + :has 写法都命中）', hiddenByMarker.length === 2 && hiddenByHas.length === 2 && myOrder !== null)
check('CSS 命中文件卡片总结（类名后缀匹配）', descriptions.length === 1)
check('CSS 含排序规则（我的 pill 放到分支之后、时间戳之前）', cssText.includes("span.SSPv_root{order:1}") && cssText.includes("span[class$='_endInfo']{order:2}"))
check('弹层水平位置回退为对齐触发 pill 自身', !cssText.includes('data-chat-flow-key') && cssText.includes('Math.min(Math.max(rect.left, PANEL_MARGIN), maxLeft)'))
check('弹层用左下角锚定（不读面板自身宽高，只渲染一次）', cssText.includes('window.innerHeight - rect.top + PANEL_GAP') && cssText.includes('panel.style.bottom =') && !cssText.includes('panel.offsetHeight'))
check('宽面板固定高度（工具条数不影响窗口高度）', cssText.includes('.SSPv_panelWide{min-width:min(360px,100vw - 24px);max-width:min(420px,100vw - 24px);height:min(60vh,480px)'))
check('面板不透明、不做背景模糊（展开不再卡）', cssText.includes('background:var(--dsw-alias-bg-base,#fff);backdrop-filter:none') && !cssText.includes('backdrop-filter:var(--dsw-menu-backdrop-filter)'))
check('文件卡片总结取消截断（完整折行）', cssText.includes("span[class$='_description']{display:block;white-space:normal;overflow:visible;text-overflow:clip;-webkit-line-clamp:unset") && cssText.includes('data-presented-file]{height:auto;min-height:60px}'))

console.log('\n--- 检查项 ---')
let failed = 0
for (const [label, ok] of checks) { console.log((ok ? 'PASS  ' : 'FAIL  ') + label); if (!ok) failed += 1 }
console.log(failed === 0 ? '\nALL CHECKS PASSED' : '\n' + failed + ' CHECK(S) FAILED')
process.exitCode = failed === 0 ? 0 : 1
