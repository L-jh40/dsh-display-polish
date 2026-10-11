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
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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

// ---------- DESKTOP-LIKE：无客户端 projection / 无节点数据，只有主机端 /turns ----------
{
  const hostPayload = {
    ok: true,
    totals: { turns: 3, steps: 81, llmMs: 665753, toolMs: 73556, waitMs: 0, askMs: 0, uncachedInputTokens: 5424, cacheReadTokens: 8883840, cacheWriteTokens: 0, outputTokens: 7234, cost: 0.19 },
    turns: [
      { turn: 3, model: 'deepseek-v4.1-flash-expires-on-0910', modelName: 'DeepSeek-V4.1-Flash-Expires-On-0910', steps: 4, runMs: 83000, totalTokens: 1000, llmMs: 12000, toolMs: 45000, waitMs: 3000, askMs: 0, ttftMs: 1234, tokensPerSecond: 42.5, cost: 0.1976,
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

const cssText = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const dict = {
  'number.groupSeparator': ',', 'number.thousand': '{value}K', 'number.million': '{value}M',
  'stats.counts': '{turns} 轮 {steps} 步',
  'stats.llmShort': '模型 {duration}',
  'stats.toolShort': '工具 {duration}',
  'stats.waitShort': '等待 {duration}',
  'stats.cacheHit': '缓存命中 {percent}%',
  'stats.cacheHitLabel': '缓存命中率',
  'stats.provider': '提供方',
  'stats.model': '模型',
  'stats.dialog.title': '会话统计',
  'stats.dialog.usageTitle': 'Token 用量',
  'stats.dialog.llmTime': '模型用时',
  'stats.dialog.toolTime': '工具调用用时',
  'stats.dialog.ttft': '首 token 平均（TTFT）',
  'stats.dialog.speed': '输出速度（TPS）',
  'stats.waitUser': '等待用户选择',
  'stats.askWait': '询问用时',
  'stats.turnUsageTitle': '本轮用量',
  'stats.turnUsageTitleCost': '本轮用量（{cost} 元）',
  'stats.turnUsageTrigger': '本轮 {cost} 元',
  'stats.reasoningLabel': '推理输出（{cost} 元）',
  'stats.reasoningLabelPlain': '推理输出',
  'stats.timeOther': '其他',
  'stats.withCost': '{label}（{cost} 元）',
  'stats.toolTotal': '工具调用（{amount} 元）',
  'stats.toolPerTool': '按工具',
  'stats.toolPerStep': '按 step',
  'stats.toolSummary': '{name} ×{count} → {amount} 元',
  'stats.toolStep': 'step {step}: {tools} → 本步 {amount} 元',
  'duration.compactSeconds': '{seconds}秒',
  'duration.compactMinutes': '{minutes}分{seconds}秒',
  'duration.seconds': '{seconds}秒',
  'duration.minutes': '{minutes}分{seconds}秒',
  'message.tokensPerSecond': '{tps} tok/s',
  'message.ranFor': '用时 {duration}',
  'message.turnUsage.title': '本轮用量',
  'message.turnUsage.count': '{count} tok',
  'message.turnUsage.cacheHit': '缓存命中',
  'message.turnUsage.input': '未缓存输入',
  'message.turnUsage.cacheRead': '缓存输入',
  'message.turnUsage.cacheWrite': '缓存写入',
  'message.turnUsage.output': '输出',
  'message.turnUsage.reasoning': '（其中推理 {tokens}）',
  'message.turnTime.title': '本轮用时和速度',
  'message.turnTime.duration': '本轮总用时',
  'message.turnTime.speed': '输出速度（TPS）',
  'message.turnTime.ttft': '首 token 用时（TTFT）',
}
const missingKeys = new Set()
const t = (key, params) => {
  const template = dict[key]
  if (template === undefined) { missingKeys.add(key); return '__' + key + '__' }
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

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

const makeCtx = (registrations, { failFirst = 0 } = {}) => {
  let failures = failFirst
  return {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    locale: { register: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ current: 'session-smoke' }), subscribe: () => () => {} } },
    inject: (deps, callback) => callback({
      effect: (fn) => { fn() },
      slots: {
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
check('注册 dock#stats(priority -1) 与 assistant-actions#turn-cost', registrations.length === 2 && registrations[0].options.id === 'stats' && registrations[0].options.priority === -1 && registrations[1].options.name === 'conversation.chat.assistant-actions' && registrations[1].options.id === 'turn-cost')

const retryRegistrations = []
loadPlugin().apply(makeCtx(retryRegistrations, { failFirst: 2 }))
await new Promise((resolve) => setTimeout(resolve, 900))
check('槽位尚未声明时按 250ms 重试注册', retryRegistrations.length === 2)

// ---------- 会话统计 pill ----------
const usage = { uncachedInputTokens: 100, cacheReadTokens: 9900, cacheWriteTokens: 0, outputTokens: 500 }
const stats = { turns: 2, steps: 3, llmMs: 5000, toolMs: 1000, ttftMs: 800, ttftSteps: 2, decodeMs: 4000, decodeTokens: 200 }
globalThis.fetch = async (url) => {
  if (String(url).startsWith('/api/balance/turns')) return { ok: true, json: async () => ({ ok: true, totals: { waitMs: 4200 }, turns: [] }) }
  return { ok: true, json: async () => ({ ok: false }) }
}
const statsComp = registrations.find((r) => r.options.id === 'stats').component
const pills = await render(React.createElement(statsComp, {
  t, sessionId: 'session-dock',
  useChat: (selector) => selector({ legacy: { nodes: [] } }),
  useProjection: (key) => (key === 'tokenUsage' ? usage : stats),
}))
const pillsText = pills.host.textContent
console.log('PILLS TEXT:', JSON.stringify(pillsText))
check('会话缓存命中：官方计算方式 + 两位小数（99.00%）', pillsText.includes('缓存命中 99.00%'))
check('会话内联用短标签（模型/工具/等待）', pillsText.includes('模型 5秒') && pillsText.includes('工具 1秒') && pillsText.includes('等待 4.2秒') && !pillsText.includes('模型用时'))
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
    { step: 1, tools: [{ name: 'run_code', count: 1 }], subTools: [{ name: 'pwsh', count: 2 }, { name: 'read', count: 1 }], cost: 0.0156 },
    { step: 2, tools: [{ name: 'run_code', count: 1 }], subTools: [{ name: 'pwsh', count: 1 }], cost: 0.0161 },
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
const usageBox = slot.querySelector('[data-turn-usage-details]')?.parentElement
const usageText = usageBox?.textContent ?? ''
console.log('TURN USAGE PANEL:', JSON.stringify(usageText))
check('弹层标题值=精确总 tok', usageText.includes('本轮用量（0.1976 元）8,896,498 tok'))
check('提供方/模型各一行且只显示生效那条', usageText.includes('提供方DeepSeek') && !usageText.includes('deepseek-v4-flash'))
check('模型显示目录里的名称而不是路由 id', usageText.includes('模型DeepSeek-V4.1-Flash-Expires-On-0910') && !usageText.includes('deepseek-v4.1-flash-expires-on-0910'))
check('每轮缓存命中两位小数（99.94%）', usageText.includes('缓存命中率99.94%'))
check('分桶带元金额与 token', usageText.includes('未缓存输入（0.0145 元）5,424 tok') && usageText.includes('缓存输入（0.1777 元）8,883,840 tok') && usageText.includes('输出（0.0054 元）7,234 tok'))
check('输出行不再内联「其中推理」', !usageText.includes('其中推理'))
check('推理单独一行（" -" 前缀 + 按占比折算金额）', usageText.includes('-推理输出（0.0016 元）2,116 tok'))
check('工具调用金额与明细', usageText.includes('工具调用（0.0317 元）') && usageText.includes('run_code ×2 → 0.0317 元') && usageText.includes('step 1: run_code ×1 → 本步 0.0156 元'))
check('子工具按层级显示（工具下面的 -pwsh / -read）', usageText.includes('-pwsh ×3') && usageText.includes('-read ×1'))
check('每步子工具也按层级显示', usageText.includes('-pwsh ×2') && usageText.includes('-read ×1'))
check('弹层底部对齐（固定底线 − 面板高）', cssText.includes('panelBottom - height') && cssText.includes('PANEL_BOTTOM_RATIO'))

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
check('CSS 含排序规则（我的 pill 放到分支之后、时间戳之前）', cssText.includes("span.SSPv_root{order:10}") && cssText.includes("span[class$='_timeEnd']{order:20}"))
check('弹层水平位置回退为对齐触发 pill 自身', !cssText.includes('data-chat-flow-key') && cssText.includes('Math.min(Math.max(rect.left, PANEL_MARGIN), maxLeft)'))
check('弹层竖直位置固定（不再跟随触发点/翻转）', cssText.includes('window.innerHeight * PANEL_TOP_RATIO') && !cssText.includes('rect.top - PANEL_GAP - height'))
check('宽面板固定高度（工具条数不影响窗口高度）', cssText.includes('.SSPv_panelWide{min-width:min(360px,100vw - 24px);max-width:min(520px,100vw - 24px);height:min(60vh,480px)}'))
check('文件卡片总结取消截断（完整折行）', cssText.includes("span[class$='_description']{display:block;white-space:normal;overflow:visible;text-overflow:clip;-webkit-line-clamp:unset") && cssText.includes('data-presented-file]{height:auto;min-height:60px}'))

console.log('\n--- 检查项 ---')
let failed = 0
for (const [label, ok] of checks) { console.log((ok ? 'PASS  ' : 'FAIL  ') + label); if (!ok) failed += 1 }
if (missingKeys.size > 0) { console.log('MISSING LOCALE KEYS:', [...missingKeys].join(', ')); failed += 1 }
console.log(failed === 0 ? '\nALL CHECKS PASSED' : '\n' + failed + ' CHECK(S) FAILED')
process.exitCode = failed === 0 ? 0 : 1
