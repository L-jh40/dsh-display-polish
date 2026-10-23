/**
 * dsh-display-polish —— DSH 0.1.5 新版显示框架内的读数插件（v0.4.0）。
 *
 * 设计约束（来自 0.1.5 槽位运行时源码）：
 *  - 注册表按 (id|key, priority) 去重，「priority 更低者渲染」；同一个 key 用 -1 即可接管。
 *  - 但每条条目的 renderSlot / renderSlotChain 只能渲染**自己 children 里声明过的槽**
 *    （slot 运行时 boundRenderSlot 会校验 entry.children[key]，否则抛 SlotOwnershipError，
 *     条目随即被 abdicate 回退到官方实现）。官方收尾条目已声明了 turnTail / assistant-actions，
 *    插件无法再声明同名 children，因此**不能**替换收尾条目本身。
 *
 * 于是本插件：
 *  1. conversation.composer.dock id='stats'（priority -1）：接管官方 StatsPills 单元格，
 *     外观逐字复刻新版 pill，内联分出「模型用时 / 工具调用用时 / 等待用户选择」，
 *     缓存命中率沿用官方计算方式（精确有理比较、部分命中绝不进位到 100），显示保留两位小数。
 *  2. conversation.chat.assistant-actions id='turn-cost'（list，纯新增）：
 *     在官方收尾操作行里渲染两枚 pill —— 「本轮用量（金额 元）」把官方用量与插件花费合并，
 *     以及「用时」。同时用 CSS 隐藏官方那两枚 pill，避免重复；
 *     官方产物链、收尾动作、反馈按钮全部保持原样（不再抢占 turnTail 链）。
 *
 * 0.2.0 踩过的坑（改动时务必保留这些兜底，别再退回旧写法）：
 *  A. primitives 的图标导出改名：Icon*16（1.5 版）→ Icon*Regular（16px）/ Icon*Medium。
 *     直接写 primitives.IconGaugeOutline16 会得到 undefined，React 在协调阶段抛
 *     「Element type is invalid」（压缩版 #130）——槽位条目随即被自己的错误边界摘掉，
 *     现象是「注册成功、连渲染函数都跑了，但整块静默消失、控制台里也看不到堆栈」。
 *     现在统一走 iconOf(...) 回退链，最后兜到自带内联 svg。
 *  B. safeRender 只挡得住「创建元素时」抛的错；子组件在渲染阶段抛的错会冒到槽位上。
 *     现在 safeRender 外面套了真正的 React 错误边界 PillBoundary，会报 error:<组件> 到宿主日志。
 *  C. 0.2.0 把官方用量 pill 和时间戳一起放进了 _actions > span._endInfo，旧规则只认
 *     _actions 的直接子元素，所以官方用量 pill 一直没被藏掉；插件 pill 的 order 也要改成
 *     「排在 _endInfo（时间块）之前」才是官方那个位置。
 *  D. 面板必须 createPortal 到 document.body：收尾操作行是 hover 才淡入的，
 *     面板挂在行里会跟着行一起变半透明（官方也是 portal + backdrop-filter）。
 *     面板底边固定贴在触发 pill 上方 PANEL_GAP，高度由 CSS 固定，工具链长度不影响高度。
 *  E. 对话栏下方那行的「模型 X」只显示到分钟（秒位会不停跳动），金额一律 4 位小数。
 *  F. 每轮「本轮用量」面板末尾追加「子工具调用」汇总：各 subTool 的次数 + 按次数分摊的金额 + 合计。
 *  C. assistant-actions 只给 { messageId }，且 useChat 在 0.2.0 查不到收尾节点是常态。
 *     轮次现在按「节点 location → data-turn-tail → 主机端 /api/balance/turns 的 messageIds 反查」取，
 *     并且组件永远先渲染那层 display:contents 的壳（否则 ref 为空，轮次永远回填不上）。
 */
window.__ModuleLoader__.load({
	id: "dsh-display-polish",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let reactDom = require("react-dom");
		const h = react.createElement;
		const Fragment = react.Fragment;
		/*
		 * 0.2.0 起 @deepseek-ai/dsh-client-ui-primitives 的图标导出改名：
		 * 旧的 Icon*16（1.5 版）→ Icon*Regular（16px）/ Icon*Medium。
		 * 直接写 primitives.IconGaugeOutline16（1.5 的名字）会拿到 undefined，React 在协调阶段抛
		 * 「Element type is invalid」——槽位条目随即被自己的错误边界摘掉，
		 * 表现就是「注册成功、渲染函数也跑了（props 有日志），但整块静默消失」。
		 * 这里按 16 → Regular → Medium 依次回退，全都没有时退到自带内联 svg，
		 * 保证「图标改名」永远不再是致命错误。
		 */
		const fallbackIcon = (props) => h("svg", {
			viewBox: "0 0 16 16",
			width: 14,
			height: 14,
			"aria-hidden": true,
			...props
		}, h("circle", {
			cx: 8,
			cy: 8,
			r: 6,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.2
		}));
		const iconOf = (...names) => {
			for (const name of names) {
				const value = primitives === void 0 || primitives === null ? void 0 : primitives[name];
				if (typeof value === "function" || typeof value === "object" && value !== null) return value;
			}
			return fallbackIcon;
		};
		const IconGauge = iconOf("IconGaugeOutline16", "IconGaugeOutlineRegular", "IconGaugeOutlineMedium");
		const IconClock = iconOf("IconClockOutline16", "IconClockOutlineRegular", "IconClockOutlineMedium");
		const IconDatabase = iconOf("IconDatabaseOutline16", "IconDatabaseOutlineRegular", "IconDatabaseOutlineMedium");
		/*
		 * 真正的 React 错误边界：safeRender 只能挡住「创建元素时」同步抛出的错误，
		 * 子组件在渲染/协调阶段抛的错会冒到槽位自己的边界上，整条条目被摘掉。
		 * （本轮事故就是这样：图标取到 undefined，条目静默退位，日志里一行都没有。）
		 */
		class PillBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				const label = this.props.label ?? "pill";
				report("error:" + label, String(error?.stack ?? error).slice(0, 300));
			}
			render() {
				return this.state.failed ? null : this.props.children;
			}
		}
		//#region 样式：官方 StatsPills / TurnUsagePanel / stat-dialog 同款（自有前缀）+ 两处官方覆盖
		const css = [
			".SSPv_pillsRoot{max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;gap:12px;margin:0 auto;display:flex}",
			".SSPv_anchor{min-width:0;display:inline-flex}",
			".SSPv_pill{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}",
			".SSPv_pill svg{flex:none;width:14px;height:14px}",
			"button.SSPv_pill{cursor:pointer}",
			"button.SSPv_pill:hover,button.SSPv_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".SSPv_pillLabel{min-width:0;overflow:hidden;display:flex;align-items:center}",
			".SSPv_pillGrow{min-width:0;overflow:hidden;text-overflow:ellipsis}",
			".SSPv_pillFixed{flex:none}",
			".SSPv_pillSep{color:var(--dsw-alias-separator-primary);margin:0 6px}",
			".SSPv_panel{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);max-height:calc(100vh - 24px);overflow-y:auto;overscroll-behavior:contain;box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;position:fixed}",
			/* 宽面板（每轮「本轮用量」）：固定高度，工具调用条数再多也不改变窗口高度，内部滚动。 */
			".SSPv_panelWide{min-width:min(360px,100vw - 24px);max-width:min(520px,100vw - 24px);height:min(60vh,480px)}",
			".SSPv_panelTitle{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}",
			".SSPv_panelTitleValue{font-variant-numeric:tabular-nums;white-space:nowrap}",
			".SSPv_panelTitleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}",
			".SSPv_panelTitleLabel svg{flex:none;width:14px;height:14px}",
			".SSPv_panelRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}",
			".SSPv_panelDetails{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(96px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}",
			".SSPv_panelDetails dt,.SSPv_panelDetails dd{min-width:0;margin:0}",
			".SSPv_panelDetails dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}",
			".SSPv_panelDetails .SSPv_panelRoute{overflow-wrap:anywhere}",
			".SSPv_reasoning{color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".SSPv_panelSub{margin-top:12px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}",
			".SSPv_panelSubTitle{color:var(--dsw-alias-label-primary);margin-bottom:4px;font-weight:500}",
			".SSPv_panelSubLabel{color:var(--dsw-alias-label-tertiary);margin:6px 0 2px}",
			".SSPv_toolLine{font-variant-numeric:tabular-nums;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}",
			".SSPv_toolSub{padding-left:14px;font-variant-numeric:tabular-nums;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary)}",
			".SSPv_root{min-width:0;display:inline-flex}",
			".SSPv_root+.SSPv_root{margin-left:-6px}",
			".SSPv_trigger{min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:28px;align-items:center;gap:4px;padding:6px 8px;display:inline-flex}",
			".SSPv_trigger svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));flex:none}",
			".SSPv_trigger:hover,.SSPv_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".SSPv_triggerLabel{text-overflow:ellipsis;min-width:0;overflow:hidden}",
			"@media (width<=560px){.SSPv_trigger .SSPv_triggerLabel{display:none}.SSPv_trigger{width:calc(28px + var(--dsh-content-font-delta,0px));justify-content:center;padding:6px}.SSPv_root+.SSPv_root{margin-left:0}}",
			/*
			 * 覆盖一：隐藏官方收尾操作行里的两枚 pill（本轮用量 / 本轮用时），改由本插件渲染合并版。
			 * 注意：槽位内容外面还有一层 <div data-slot=... style="display:contents"> 包装，
			 * 因此不能用「> span.SSPv_root」判断自己的 pill 是否存在（上一版就是这么失效的）。
			 * 主规则依赖插件挂载时给操作行打上的 data-statsline-turn-pills 标记：
			 * 只有插件 pill 真的渲染出来才隐藏官方 pill，万一插件没生效官方显示照旧。
			 * :has() 那条单独成规则，浏览器不支持时只会丢掉它自己。
			 */
			"[data-turn-tail] div[class$='_actions'][data-statsline-turn-pills] > span[class$='_root']:not(.SSPv_root){display:none!important}",
			/*
			 * 0.2.0 把官方用量 pill 和时间戳一起塞进了 _actions > span._endInfo，
			 * 上面那条「只认直接子元素」的规则再也匹配不到它 —— 于是官方用量 pill 一直留在页面上。
			 * 这两条按 endInfo 内部匹配（endInfo 里只有官方用量 pill 是 span._root，时间戳是 span._timeEnd）。
			 */
			"[data-turn-tail] div[class$='_actions'][data-statsline-turn-pills] span[class$='_endInfo'] > span[class$='_root']:not(.SSPv_root){display:none!important}",
			"[data-turn-tail] div[class$='_actions']:has([data-slot='conversation.chat.assistant-actions'] span.SSPv_root) span[class$='_endInfo'] > span[class$='_root']:not(.SSPv_root){display:none!important}",
			/* 排序：本插件 pill 紧贴在「时间 / 收尾信息块」左边，占官方用量 pill 原来的位置。 */
			"[data-turn-tail] div[class$='_actions'] [data-slot='conversation.chat.assistant-actions'] span.SSPv_root{order:1}",
			"[data-turn-tail] div[class$='_actions'] > span[class$='_endInfo']{order:2}",
			/*
			 * 覆盖二：官方产物文件卡片的「总结」原本是单行省略号（white-space:nowrap + ellipsis），
			 * 这里取消截断，完整折行显示（卡片高度自适应）。用「类名后缀」匹配，避免绑定构建哈希。
			 * 注意官方还会用正则剥掉描述**末尾的整段括号**（cardDescription），所以 present 的
			 * 说明不要以括号结尾，否则那一段永远看不到。
			 */
			"[data-presented-file]{height:auto;min-height:60px}",
			"[data-presented-file] span[class$='_description']{display:block;white-space:normal;overflow:visible;text-overflow:clip;-webkit-line-clamp:unset;line-clamp:unset}",
		].join("");
		const tagId = "dsh-display-polish/StatsPills.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-display-polish";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const cls = {
			pillsRoot: "SSPv_pillsRoot",
			anchor: "SSPv_anchor",
			pill: "SSPv_pill",
			pillLabel: "SSPv_pillLabel",
			pillGrow: "SSPv_pillGrow",
			pillFixed: "SSPv_pillFixed",
			pillSep: "SSPv_pillSep",
			panel: "SSPv_panel",
			panelWide: "SSPv_panelWide",
			panelTitle: "SSPv_panelTitle",
			panelTitleValue: "SSPv_panelTitleValue",
			panelTitleLabel: "SSPv_panelTitleLabel",
			panelRule: "SSPv_panelRule",
			panelDetails: "SSPv_panelDetails",
			panelRoute: "SSPv_panelRoute",
			reasoning: "SSPv_reasoning",
			panelSub: "SSPv_panelSub",
			panelSubTitle: "SSPv_panelSubTitle",
			panelSubLabel: "SSPv_panelSubLabel",
			toolLine: "SSPv_toolLine",
			toolSub: "SSPv_toolSub",
			root: "SSPv_root",
			trigger: "SSPv_trigger",
			triggerLabel: "SSPv_triggerLabel",
		};
		//#endregion
		//#region 字典（金额单位统一「元」）
		const NS = "statsline";
		const zh = {
			"number.groupSeparator": ",",
			"number.thousand": "{value}K",
			"number.million": "{value}M",
			"stats.counts": "{turns} 轮 {steps} 步",
			"stats.llmShort": "模型 {duration}",
			"stats.toolShort": "工具 {duration}",
			"stats.waitShort": "等待 {duration}",
			"stats.cacheHit": "缓存命中 {percent}%",
			"stats.cacheHitLabel": "缓存命中率",
			"stats.provider": "提供方",
			"stats.model": "模型",
			"stats.dialog.title": "会话统计",
			"stats.dialog.usageTitle": "Token 用量",
			"stats.dialog.llmTime": "模型用时",
			"stats.dialog.toolTime": "工具调用用时",
			"stats.dialog.ttft": "首 token 平均（TTFT）",
			"stats.dialog.speed": "输出速度（TPS）",
			"stats.waitUser": "等待用户选择",
			"stats.askWait": "询问用时",
			"stats.turnUsageTitle": "本轮用量",
			"stats.turnUsageTitleCost": "本轮用量（{cost} 元）",
			"stats.turnUsageTrigger": "本轮 {cost} 元",
			"stats.reasoningLabel": "推理输出（{cost} 元）",
			"stats.reasoningLabelPlain": "推理输出",
			"stats.timeOther": "其他",
			"stats.withCost": "{label}（{cost} 元）",
			"stats.toolTotal": "工具调用（{amount} 元）",
			"stats.toolPerTool": "按工具",
			"stats.toolPerStep": "按步",
			"stats.toolSummary": "{name} ×{count} → {amount} 元",
			"stats.toolStep": "第 {step} 步：{tools} → 本步 {amount} 元",
			"stats.toolSubTitle": "子工具调用",
			"stats.toolSubPerTool": "按子工具",
			"stats.toolSubSummary": "{name} ×{count} → {amount} 元",
			"stats.toolSubTotal": "合计 {count} 次 → {amount} 元",
			"duration.minutesOnly": "{minutes}分",
			"duration.compactSeconds": "{seconds}秒",
			"duration.compactMinutes": "{minutes}分{seconds}秒",
			"duration.seconds": "{seconds}秒",
			"duration.minutes": "{minutes}分{seconds}秒",
			"message.tokensPerSecond": "{tps} tok/s",
			"message.ranFor": "用时 {duration}",
			"message.turnUsage.title": "本轮用量",
			"message.turnUsage.count": "{count} tok",
			"message.turnUsage.cacheHit": "缓存命中",
			"message.turnUsage.input": "未缓存输入",
			"message.turnUsage.cacheRead": "缓存输入",
			"message.turnUsage.cacheWrite": "缓存写入",
			"message.turnUsage.output": "输出",
			"message.turnUsage.reasoning": "（其中推理 {tokens}）",
			"message.turnTime.title": "本轮用时和速度",
			"message.turnTime.duration": "本轮总用时",
			"message.turnTime.speed": "输出速度（TPS）",
			"message.turnTime.ttft": "首 token 用时（TTFT）",
		};
		const en = {
			"number.groupSeparator": ",",
			"number.thousand": "{value}K",
			"number.million": "{value}M",
			"stats.counts": "{turns} turns {steps} steps",
			"stats.llmShort": "Model {duration}",
			"stats.toolShort": "Tools {duration}",
			"stats.waitShort": "Wait {duration}",
			"stats.cacheHit": "Cache hit {percent}%",
			"stats.cacheHitLabel": "Cache hit rate",
			"stats.provider": "Provider",
			"stats.model": "Model",
			"stats.dialog.title": "Session statistics",
			"stats.dialog.usageTitle": "Token usage",
			"stats.dialog.llmTime": "LLM time",
			"stats.dialog.toolTime": "Tool time",
			"stats.dialog.ttft": "Avg time to first token (TTFT)",
			"stats.dialog.speed": "Tokens per second (TPS)",
			"stats.waitUser": "Wait for user",
			"stats.askWait": "Ask wait",
			"stats.turnUsageTitle": "Turn usage",
			"stats.turnUsageTitleCost": "Turn usage ({cost} CNY)",
			"stats.turnUsageTrigger": "Turn {cost} CNY",
			"stats.reasoningLabel": "Reasoning output ({cost} CNY)",
			"stats.reasoningLabelPlain": "Reasoning output",
			"stats.timeOther": "Other",
			"stats.withCost": "{label} ({cost} CNY)",
			"stats.toolTotal": "Tool calls ({amount} CNY)",
			"stats.toolPerTool": "By tool",
			"stats.toolPerStep": "By step",
			"stats.toolSummary": "{name} ×{count} → ¥{amount}",
			"stats.toolStep": "step {step}: {tools} → ¥{amount}",
			"stats.toolSubTitle": "Sub-tool calls",
			"stats.toolSubPerTool": "By sub-tool",
			"stats.toolSubSummary": "{name} ×{count} → ¥{amount}",
			"stats.toolSubTotal": "{count} calls → ¥{amount}",
			"duration.minutesOnly": "{minutes}m",
			"duration.compactSeconds": "{seconds}s",
			"duration.compactMinutes": "{minutes}m{seconds}s",
			"duration.seconds": "{seconds}s",
			"duration.minutes": "{minutes}m{seconds}s",
			"message.tokensPerSecond": "{tps} tok/s",
			"message.ranFor": "Ran for {duration}",
			"message.turnUsage.title": "Turn usage",
			"message.turnUsage.count": "{count} tok",
			"message.turnUsage.cacheHit": "Cache hit",
			"message.turnUsage.input": "Uncached input",
			"message.turnUsage.cacheRead": "Cached input",
			"message.turnUsage.cacheWrite": "Cache write",
			"message.turnUsage.output": "Output",
			"message.turnUsage.reasoning": " ({tokens} reasoning)",
			"message.turnTime.title": "Turn time and speed",
			"message.turnTime.duration": "Total run time",
			"message.turnTime.speed": "Tokens per second (TPS)",
			"message.turnTime.ttft": "Time to first token (TTFT)",
		};
		//#endregion
		//#region 官方口径的换算（缓存命中率、token、时长）
		function formatTokens(value, t) {
			const scaled = (candidate) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
			if (value < 1e3) return String(value);
			if (value < 1e6) return t("number.thousand", { value: scaled(value / 1e3) });
			return t("number.million", { value: scaled(value / 1e6) });
		}
		function formatExactTokens(value, t) {
			const digits = String(value);
			const groups = [];
			for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
			return groups.join(t("number.groupSeparator"));
		}
		function formatDuration(ms, t) {
			const s = ms / 1e3;
			if (s < 60) return t("duration.compactSeconds", { seconds: Math.round(s * 10) / 10 });
			const whole = Math.round(s);
			return t("duration.compactMinutes", {
				minutes: Math.floor(whole / 60),
				seconds: whole % 60
			});
		}
		/**
		 * 只到分钟的时长：对话栏下方那行的「模型 X」用它。
		 * 秒位会因为流式输出不停跳动，让整行 pill 的宽度一直变；显示到分钟就稳定了（不足 1 分按 1 分算）。
		 */
		function formatMinuteSpan(ms, t) {
			const minutes = Math.max(1, Math.floor(Math.max(0, ms) / 6e4));
			return t("duration.minutesOnly", { minutes });
		}
		function formatRunDuration(ms, t) {
			const total = Math.max(0, Math.floor(ms / 1e3));
			const minutes = Math.floor(total / 60);
			const seconds = total % 60;
			return minutes > 0 ? t("duration.minutes", {
				minutes,
				seconds: String(seconds).padStart(2, "0")
			}) : t("duration.seconds", { seconds });
		}
		function formatLatencySeconds(ms) {
			const s = Math.max(0, ms) / 1e3;
			return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s));
		}
		function formatTokensPerSecond(tps) {
			const clamped = Math.max(0, tps);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		/** 百分比单位刻度：两位小数时 1% = 100 单位。 */
		function percentScale(decimalPlaces) {
			return Math.pow(10, decimalPlaces) * 100;
		}
		/** 官方算法：把缓存读取占比四舍五入到精确百分比单位（正半数进位，纯整数运算）。 */
		function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
			const scale = percentScale(decimalPlaces);
			const doubledScale = scale * 2;
			const denominatorQuotient = Math.floor(denominator / doubledScale);
			const denominatorRemainder = denominator % doubledScale;
			let lower = 0;
			let upper = scale;
			while (lower < upper) {
				const candidate = Math.floor((lower + upper + 1) / 2);
				const factor = candidate * 2 - 1;
				if (cacheReadTokens >= factor * denominatorQuotient + Math.ceil(factor * denominatorRemainder / doubledScale)) lower = candidate;
				else upper = candidate - 1;
			}
			return lower;
		}
		/** 定长小数输出（两位小数时恒补零，如 99.00 / 99.90）。 */
		function displayPercentUnits(units, decimalPlaces) {
			const scale = Math.pow(10, decimalPlaces);
			const whole = Math.floor(units / scale);
			const fraction = units % scale;
			if (decimalPlaces === 0) return String(whole);
			return whole + "." + String(fraction).padStart(decimalPlaces, "0");
		}
		/**
		 * 官方口径的缓存命中率，默认保留两位小数。
		 * 计算方式与官方 formatCacheHitPercent 完全一致：整数域精确比较；
		 * 一旦两位小数会把「部分命中」进位成 100.00，就退到官方那套自动加精度的写法
		 * （如 99.9999），绝不让部分命中显示成 100。
		 */
		function formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 2) {
			if (promptTokens === 0) return null;
			const missedInputTokens = promptTokens - cacheReadTokens;
			if (missedInputTokens === 0) return "100";
			const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces);
			if (roundedUnits < percentScale(decimalPlaces)) return displayPercentUnits(roundedUnits, decimalPlaces);
			let distinguishingPlaces = 1;
			let scaledDoubleGap = missedInputTokens * 200;
			const denominatorTens = Math.floor(promptTokens / 10);
			while (scaledDoubleGap <= denominatorTens) {
				scaledDoubleGap *= 10;
				distinguishingPlaces += 1;
			}
			const denominatorOnes = promptTokens % 10;
			let roundedLoss = 5;
			for (let loss = 1; loss < 5; loss += 1) {
				const factor = loss * 2 + 1;
				const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10);
				if (scaledDoubleGap <= threshold) {
					roundedLoss = loss;
					break;
				}
			}
			return "99." + "9".repeat(distinguishingPlaces - 1) + String(10 - roundedLoss);
		}
		function billedInputTokens(usage) {
			return usage.uncachedInputTokens + usage.cacheReadTokens + (usage.cacheWriteTokens ?? 0);
		}
		function sessionCacheHitPercent(usage) {
			return formatCacheHitPercent(usage.cacheReadTokens, billedInputTokens(usage), 2);
		}
		function turnCacheHitPercent(usage) {
			if (usage === void 0 || usage === null || usage.cacheReadTokens === void 0 || usage.totalTokens === void 0) return null;
			return formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 2);
		}
		function fmt4(n) {
			const value = typeof n === "number" && Number.isFinite(n) ? n : 0;
			return value.toLocaleString(undefined, {
				minimumFractionDigits: 4,
				maximumFractionDigits: 4
			});
		}
		function usageOutputTokens(usage) {
			if (typeof usage !== "object" || usage === null) return null;
			const value = usage.outputTokens;
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
		}
		function assistantStepReading(node) {
			const timing = node.timing;
			return {
				ttftMs: timing !== void 0 && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
				decodeMs: timing !== void 0 && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
				outputTokens: usageOutputTokens(node.usage)
			};
		}
		function deriveStats(nodes) {
			const turns = new Set();
			let steps = 0;
			let llmMs = 0;
			let toolMs = 0;
			let ttftMs = 0;
			let ttftSteps = 0;
			let decodeMs = 0;
			let decodeTokens = 0;
			for (const node of nodes) {
				if (node.kind === "tool-result") {
					if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
					continue;
				}
				if (node.kind !== "assistant") continue;
				turns.add(node.turn);
				steps += 1;
				if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
				const reading = assistantStepReading(node);
				if (reading.ttftMs !== null) {
					ttftMs += reading.ttftMs;
					ttftSteps += 1;
				}
				if (reading.decodeMs !== null && reading.outputTokens !== null) {
					decodeMs += reading.decodeMs;
					decodeTokens += reading.outputTokens;
				}
			}
			return {
				turns: turns.size,
				steps,
				llmMs,
				toolMs,
				ttftMs,
				ttftSteps,
				decodeMs,
				decodeTokens
			};
		}
		//#endregion
		//#region 弹层底座（官方 stat-dialog 同款 + 可滚动 + 视口钳制）
		const PANEL_MARGIN = 12;
		/** 面板底边与触发 pill 之间的间距（官方 useAnchoredPosition side:"top" 的同款语义）。 */
		const PANEL_GAP = 8;
		/** 面板高度由 CSS 固定：.SSPv_panelWide = min(60vh, 480px)，内容在面板内部滚动。 */
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		function useStatDialog(controlled) {
			const [ownOpen, setOwnOpen] = react.useState(false);
			const open = controlled !== void 0 && controlled !== null ? controlled.open : ownOpen;
			const setOpen = controlled !== void 0 && controlled !== null ? controlled.setOpen : setOwnOpen;
			const rootRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const [pos, setPos] = react.useState(null);
			react.useLayoutEffect(() => {
				if (!open) {
					setPos(null);
					return;
				}
				const anchor = rootRef.current;
				if (anchor === null) return;
				const place = () => {
					const panel = panelRef.current;
					if (panel === null) return;
					const rect = anchor.getBoundingClientRect();
					const width = panel.offsetWidth;
					const height = panel.offsetHeight;
					const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
					const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN);
					/* 水平：像原来一样左对齐到触发 pill 自身。 */
					let left = Math.min(Math.max(rect.left, PANEL_MARGIN), maxLeft);
					/*
					 * 竖直：面板底边固定在「触发 pill 顶边 − PANEL_GAP」处（官方 useAnchoredPosition
					 * side:"top" 的语义：弹在触发点上方一点）。高度由 CSS 固定、超长内容在面板内部滚动，
					 * 所以工具链再长也不会改变面板的高度和位置。
					 */
					const panelBottom = rect.top - PANEL_GAP;
					let top = Math.min(Math.max(panelBottom - height, PANEL_MARGIN), maxTop);
					setPos({
						left: Math.round(left) + "px",
						top: Math.round(top) + "px"
					});
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [open]);
			react.useEffect(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (rootRef.current !== null && rootRef.current.contains(target)) return;
					if (panelRef.current !== null && panelRef.current.contains(target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open, setOpen]);
			return {
				open,
				setOpen,
				rootRef,
				panelRef,
				pos
			};
		}
		/**
		 * 弹层底座。用官方同款做法 createPortal 到 document.body：
		 * 面板不再继承触发点祖先的 opacity / overflow（收尾操作行是「hover 才淡入」的），
		 * 鼠标移到面板上、行失去 hover 时面板也就不会变成半透明。
		 */
		function StatPanel(props) {
			const panel = h("div", {
				ref: props.panelRef,
				className: cls.panel + (props.wide === true ? " " + cls.panelWide : ""),
				role: "dialog",
				"aria-label": props.ariaLabel !== undefined ? props.ariaLabel : props.title,
				style: props.pos !== null && props.pos !== void 0 ? props.pos : MEASURE_STYLE
			}, h("div", { className: cls.panelTitle }, h("span", {
				className: cls.panelTitleLabel
			}, props.icon !== void 0 ? h(props.icon, {}) : null, props.title), props.titleValue !== void 0 ? h("span", {
				className: cls.panelTitleValue
			}, props.titleValue) : null), h("div", {
				className: cls.panelRule,
				"aria-hidden": true
			}), props.children);
			return typeof document === "undefined" || reactDom === void 0 || typeof reactDom.createPortal !== "function" ? panel : reactDom.createPortal(panel, document.body);
		}
		//#endregion
		//#region 每轮统计的共享读取（一次请求喂所有轮次）
		const TURNS_TTL_MS = 4000;
		let turnsCache = {
			sessionId: void 0,
			at: 0,
			value: null,
			promise: null
		};
		function fetchTurns(sessionId) {
			const now = Date.now();
			if (turnsCache.sessionId === sessionId) {
				if (turnsCache.value !== null && now - turnsCache.at < TURNS_TTL_MS) return Promise.resolve(turnsCache.value);
				if (turnsCache.promise !== null) return turnsCache.promise;
			}
			const url = sessionId === void 0 ? "/api/balance/turns" : "/api/balance/turns?session=" + encodeURIComponent(sessionId);
			const promise = fetch(url).then((response) => response.json()).then((body) => {
				if (body !== null && typeof body === "object" && body.ok === true && Array.isArray(body.turns)) {
					turnsCache = {
						sessionId,
						at: Date.now(),
						value: body,
						promise: null
					};
					return body;
				}
				turnsCache = {
					sessionId,
					at: 0,
					value: null,
					promise: null
				};
				return null;
			}).catch(() => {
				turnsCache = {
					sessionId,
					at: 0,
					value: null,
					promise: null
				};
				return null;
			});
			turnsCache = {
				sessionId,
				at: 0,
				value: null,
				promise
			};
			return promise;
		}
		/** 某一轮的主机端统计；轮次刚结束可能稍晚就绪，故带重试。 */
		function useTurnEntry(sessionId, turn, messageId) {
			const [entry, setEntry] = react.useState(null);
			react.useEffect(() => {
				let live = true;
				let timer = void 0;
				let attempts = 0;
				setEntry(null);
				if (turn === void 0 && messageId === void 0) return;
				const read = (body) => {
					if (body === null) return false;
					/* 桌面版 0.2.0 的 data-turn-tail 可能与主机端轮次编号不一致，再按 messageId 反查一次。 */
					const found = (turn === void 0 ? void 0 : body.turns.find((item) => item.turn === turn)) ?? (messageId === void 0 ? void 0 : body.turns.find((item) => Array.isArray(item.messageIds) && item.messageIds.includes(messageId)));
					if (found === void 0 || typeof found.cost !== "number") return false;
					const detail = found.detail;
					setEntry({
						cost: found.cost,
						model: typeof found.model === "string" && found.model.length > 0 ? found.model : void 0,
						modelName: typeof found.modelName === "string" && found.modelName.length > 0 ? found.modelName : void 0,
						llmMs: typeof found.llmMs === "number" ? found.llmMs : void 0,
						toolMs: typeof found.toolMs === "number" ? found.toolMs : void 0,
						waitMs: typeof found.waitMs === "number" ? found.waitMs : void 0,
						ttftMs: typeof found.ttftMs === "number" ? found.ttftMs : void 0,
						tokensPerSecond: typeof found.tokensPerSecond === "number" ? found.tokensPerSecond : void 0,
						askMs: typeof found.askMs === "number" ? found.askMs : 0,
						runMs: typeof found.runMs === "number" ? found.runMs : void 0,
						totalTokens: typeof found.totalTokens === "number" ? found.totalTokens : void 0,
						modelNames: body.modelNames !== null && typeof body.modelNames === "object" ? body.modelNames : void 0,
						providerNames: body.providerNames !== null && typeof body.providerNames === "object" ? body.providerNames : void 0,
						modelProviders: body.modelProviders !== null && typeof body.modelProviders === "object" ? body.modelProviders : void 0,
						detail: detail !== void 0 && detail !== null && typeof detail.uncachedInputCost === "number" && typeof detail.cacheReadCost === "number" && typeof detail.outputCost === "number" ? detail : null,
						steps: Array.isArray(found.stepsDetail) ? found.stepsDetail : [],
						turn: typeof found.turn === "number" ? found.turn : void 0
					});
					return true;
				};
				const poll = () => {
					attempts += 1;
					fetchTurns(sessionId).then((body) => {
						if (!live) return;
						if (read(body)) return;
						if (attempts < 12) timer = setTimeout(poll, 3000);
					});
				};
				poll();
				return () => {
					live = false;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [sessionId, turn]);
			return entry;
		}
		/** 工具调用明细：按工具聚合 + 按 step 明细。 */
		function toolBreakdown(steps) {
			let total = 0;
			const perTool = new Map();
			for (const step of steps) {
				const stepCost = typeof step.cost === "number" ? step.cost : 0;
				const tools = Array.isArray(step.tools) ? step.tools : [];
				if (tools.length === 0) continue;
				total += stepCost;
				const totalCount = tools.reduce((sum, item) => sum + item.count, 0) || 1;
				for (const item of tools) {
					const current = perTool.get(item.name) ?? {
						count: 0,
						cost: 0
					};
					current.count += item.count;
					current.cost += stepCost * item.count / totalCount;
					perTool.set(item.name, current);
				}
			}
			const summary = [...perTool.entries()].map(([name, value]) => ({
				name,
				count: value.count,
				cost: value.cost
			})).sort((a, b) => b.cost - a.cost);
			const stepLines = steps.filter((step) => Array.isArray(step.tools) && step.tools.length > 0);
			/* run_code 内部真正调用的工具（pwsh / read / edit / grep / …）汇总：父工具下面一层。 */
			/*
			 * 子工具（run_code 内部真正执行的 pwsh / read / edit / grep…）：主机端只给次数，
			 * 金额按「本步调用次数占比」把该步金额分摊下去（与上面按工具分摊同一口径）。
			 */
			const subTools = new Map();
			let subCount = 0;
			for (const step of steps) {
				const subs = Array.isArray(step.subTools) ? step.subTools : [];
				if (subs.length === 0) continue;
				const stepCost = typeof step.cost === "number" ? step.cost : 0;
				const subTotal = subs.reduce((sum, item) => sum + item.count, 0);
				for (const sub of subs) {
					const current = subTools.get(sub.name) ?? {
						count: 0,
						cost: 0
					};
					current.count += sub.count;
					current.cost += subTotal > 0 ? stepCost * sub.count / subTotal : 0;
					subTools.set(sub.name, current);
					subCount += sub.count;
				}
			}
			const subSummary = [...subTools.entries()].map(([name, value]) => ({
				name,
				count: value.count,
				cost: value.cost
			})).sort((a, b) => b.cost - a.cost || b.count - a.count);
			const subCost = subSummary.reduce((sum, item) => sum + item.cost, 0);
			return {
				total,
				summary,
				subSummary,
				subCount,
				subCost,
				stepLines
			};
		}
		/**
		 * 目录里查不到时的兜底显示名：把路由 id 变成可读名字
		 * （deepseek-official → DeepSeek Official，deepseek-v4.1-flash → DeepSeek V4.1 Flash）。
		 */
		function prettyName(id) {
			if (typeof id !== "string" || id.length === 0) return id;
			return id.split(/[-_]/).filter((part) => part.length > 0).map((part) => /^v?\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
		}

		/** 合并后的「本轮用量」pill：官方用量 + 插件花费（金额 4 位小数，单位元）。 */
		function TurnUsagePanel(props) {
			const dialog = useStatDialog();
			const t = props.t;
			const usage = props.tokenUsage;
			const entry = props.entry;
			const tokens = {
				uncached: usage?.uncachedInputTokens ?? entry?.detail?.uncachedInputTokens ?? 0,
				cacheRead: usage?.cacheReadTokens ?? entry?.detail?.cacheReadTokens,
				cacheWrite: usage?.cacheWriteTokens ?? entry?.detail?.cacheWriteTokens,
				output: usage?.outputTokens ?? entry?.detail?.outputTokens ?? 0,
				/* 0.2.0 桌面版槽位只给 messageId、拿不到节点，用量总数由主机端 totalTokens 兜底。 */
				total: usage?.totalTokens ?? entry?.totalTokens,
				reasoning: usage?.reasoningTokens
			};
			const cost = entry !== null && entry !== void 0 ? entry.cost : void 0;
			const title = cost === void 0 ? t("stats.turnUsageTitle") : t("stats.turnUsageTitleCost", { cost: fmt4(cost) });
			/* 外面（chip）只显示「本轮 0.4216 元」。 */
			const trigger = cost === void 0 ? t("message.turnUsage.title") : t("stats.turnUsageTrigger", { cost: fmt4(cost) });
			const detail = entry?.detail ?? null;
			/* 只显示该轮真正生效的那一次请求的提供方 / 模型（旧模型回退到新模型时 routes 会有多条）。 */
			const routes = usage?.routes ?? [];
			const route = routes.length > 0 ? routes[routes.length - 1] : void 0;
			const providerNames = entry?.providerNames ?? {};
			const modelProviders = entry?.modelProviders ?? {};
			/* 0.2.0 桌面版拿不到每轮节点里的 provider：用主机端目录（model → provider）反查。 */
			let providerId = route?.provider;
			if ((providerId === void 0 || providerId.length === 0) && entry?.model !== void 0) providerId = modelProviders[entry.model];
			const provider = providerId === void 0 || providerId.length === 0 ? void 0 : providerNames[providerId] ?? prettyName(providerId);
			/* 模型：优先用主机端从「活动模型目录」取到的显示名（名字改过也跟着变），
			   其次才是请求头里记录的路由 id。 */
			const routeModel = route?.model !== void 0 && route.model.length > 0 ? route.model : void 0;
			const rawModel = entry?.model !== void 0 && entry.model.length > 0 ? entry.model : routeModel;
			const modelNames = entry?.modelNames ?? {};
			const model = entry?.modelName !== void 0 && entry.modelName.length > 0
				? entry.modelName
				: (rawModel === void 0 ? void 0 : modelNames[rawModel] ?? prettyName(rawModel));
			const hit = turnCacheHitPercent(usage);
			const withCost = (label, amount) => amount === void 0 || !Number.isFinite(amount) ? label : t("stats.withCost", {
				label,
				cost: fmt4(amount)
			});
			const breakdown = toolBreakdown(entry?.steps ?? []);
			const rows = [];
			if (provider !== void 0) rows.push(h(Fragment, { key: "provider" }, h("dt", null, t("stats.provider")), h("dd", { className: cls.panelRoute }, provider)));
			if (model !== void 0) rows.push(h(Fragment, { key: "model" }, h("dt", null, t("stats.model")), h("dd", {
				className: cls.panelRoute,
				title: model !== rawModel ? rawModel : void 0
			}, model)));
			if (hit !== null) rows.push(h(Fragment, { key: "hit" }, h("dt", null, t("stats.cacheHitLabel")), h("dd", null, hit + "%")));
			rows.push(h(Fragment, { key: "in" }, h("dt", null, withCost(t("message.turnUsage.input"), detail?.uncachedInputCost)), h("dd", null, t("message.turnUsage.count", { count: formatExactTokens(tokens.uncached, t) }))));
			if (tokens.cacheRead !== void 0) rows.push(h(Fragment, { key: "cr" }, h("dt", null, withCost(t("message.turnUsage.cacheRead"), detail?.cacheReadCost)), h("dd", null, t("message.turnUsage.count", { count: formatExactTokens(tokens.cacheRead, t) }))));
			if (tokens.cacheWrite !== void 0 && tokens.cacheWrite !== 0) rows.push(h(Fragment, { key: "cw" }, h("dt", null, withCost(t("message.turnUsage.cacheWrite"), detail?.cacheWriteCost)), h("dd", null, t("message.turnUsage.count", { count: formatExactTokens(tokens.cacheWrite, t) }))));
			rows.push(h(Fragment, { key: "out" }, h("dt", null, withCost(t("message.turnUsage.output"), detail?.outputCost)), h("dd", null, t("message.turnUsage.count", { count: formatExactTokens(tokens.output, t) }))));
			/*
			 * 推理输出单独一行（" -" 前缀 = 总-分结构）。它仍是输出的一部分：
			 * 金额按其在输出 token 中的占比从输出金额里拆分（不是额外费用）。
			 */
			if (tokens.reasoning !== void 0 && tokens.reasoning > 0) {
				const reasoningCost = detail !== null && detail !== void 0 && typeof detail.outputCost === "number" && tokens.output > 0 ? detail.outputCost * tokens.reasoning / tokens.output : void 0;
				rows.push(h(Fragment, { key: "reasoning" }, h("dt", null, "-" + (reasoningCost === void 0 ? t("stats.reasoningLabelPlain") : t("stats.reasoningLabel", { cost: fmt4(reasoningCost) }))), h("dd", null, t("message.turnUsage.count", { count: formatExactTokens(tokens.reasoning, t) }))));
			}
			return h("span", {
				ref: dialog.rootRef,
				className: cls.root
			}, h("button", {
				type: "button",
				className: cls.trigger,
				"aria-haspopup": "dialog",
				"aria-expanded": dialog.open,
				"aria-label": title,
				"data-turn-usage": props.turn,
				onClick: () => {
					dialog.setOpen(!dialog.open);
				}
			}, h(IconDatabase, {}), h("span", {
				className: cls.triggerLabel
			}, trigger)), dialog.open ? h(StatPanel, {
				panelRef: dialog.panelRef,
				pos: dialog.pos,
				title,
				icon: IconDatabase,
				titleValue: tokens.total !== void 0 ? t("message.turnUsage.count", { count: formatExactTokens(tokens.total, t) }) : void 0,
				wide: true,
				ariaLabel: t("stats.turnUsageTitle")
			}, h("dl", {
				className: cls.panelDetails,
				"data-turn-usage-details": props.turn
			}, rows), breakdown.total > 0 ? h("div", {
				className: cls.panelSub
			}, h("div", {
				className: cls.panelSubTitle
			}, t("stats.toolTotal", { amount: fmt4(breakdown.total) })), breakdown.summary.length > 0 ? h("div", {
				className: cls.panelSubLabel
			}, t("stats.toolPerTool")) : null, breakdown.summary.map((item) => h("div", {
				key: "sum-" + item.name,
				className: cls.toolLine
			}, t("stats.toolSummary", {
				name: item.name,
				count: item.count,
				amount: fmt4(item.cost)
			}))), breakdown.stepLines.length > 0 ? h("div", {
				className: cls.panelSubLabel
			}, t("stats.toolPerStep")) : null, breakdown.stepLines.map((step, index) => h("div", {
				key: "step-" + String(step.step ?? index),
				className: cls.toolLine
			}, t("stats.toolStep", {
				step: step.step,
				tools: step.tools.map((item) => item.name + " ×" + item.count).join(", ") || "-",
				amount: fmt4(typeof step.cost === "number" ? step.cost : 0)
			}), (Array.isArray(step.subTools) ? step.subTools : []).map((sub) => h("div", {
				key: "step-" + String(step.step ?? index) + "-sub-" + sub.name,
				className: cls.toolSub
			}, "-" + sub.name + " ×" + sub.count))))) : null, breakdown.subSummary.length > 0 ? h("div", {
				className: cls.panelSub,
				"data-turn-subtools": props.turn
			}, h("div", {
				className: cls.panelSubTitle
			}, t("stats.toolSubTitle")), h("div", {
				className: cls.panelSubLabel
			}, t("stats.toolSubPerTool")), breakdown.subSummary.map((item) => h("div", {
				key: "subcost-" + item.name,
				className: cls.toolLine
			}, t("stats.toolSubSummary", {
				name: item.name,
				count: item.count,
				amount: fmt4(item.cost)
			}))), h("div", {
				className: cls.toolLine
			}, t("stats.toolSubTotal", {
				count: breakdown.subCount,
				amount: fmt4(breakdown.subCost)
			}))) : null) : null);
		}
		/** 「用时」pill：官方三项 + 分出的模型 / 工具调用 / 等待用户选择用时。 */
		function TurnTimePanel(props) {
			const dialog = useStatDialog();
			const t = props.t;
			const entry = props.entry;
			/* 总-分结构：第一行「本轮总用时」，其余一律以 " -" 前缀表示它是总用时的组成部分。 */
			const sub = (label) => "-" + label;
			const breakdown = [];
			const llmMs = entry?.llmMs ?? 0;
			const toolMs = entry?.toolMs ?? 0;
			const waitMs = entry?.waitMs ?? 0;
			if (llmMs > 0) breakdown.push(h(Fragment, { key: "llm" }, h("dt", null, sub(t("stats.dialog.llmTime"))), h("dd", null, formatDuration(llmMs, t))));
			if (toolMs > 0) breakdown.push(h(Fragment, { key: "tool" }, h("dt", null, sub(t("stats.dialog.toolTime"))), h("dd", null, formatDuration(toolMs, t))));
			if (waitMs > 0) breakdown.push(h(Fragment, { key: "wait" }, h("dt", null, sub(t("stats.waitUser"))), h("dd", null, formatDuration(waitMs, t))));
			/*
			 * 「其他」= 轮次总墙钟时间未归入模型/工具/等待的部分（step 之间的间隙、收尾等）。
			 * 补上这一行，上面的分项才与「本轮总用时」对得上。
			 */
			/* 提问类工具（ask_user_question）的时长是「等人回答」，单独一行，不并入工具调用用时。 */
			const askMs = entry?.askMs ?? 0;
			if (askMs > 0) breakdown.push(h(Fragment, { key: "ask" }, h("dt", null, sub(t("stats.askWait"))), h("dd", null, formatDuration(askMs, t))));
			const restMs = Math.max(0, props.runMs - llmMs - toolMs - waitMs - askMs);
			if (entry !== null && entry !== void 0 && restMs >= 500) breakdown.push(h(Fragment, { key: "rest" }, h("dt", null, sub(t("stats.timeOther"))), h("dd", null, formatDuration(restMs, t))));
			return h("span", {
				ref: dialog.rootRef,
				className: cls.root
			}, h("button", {
				type: "button",
				className: cls.trigger,
				"aria-haspopup": "dialog",
				"aria-expanded": dialog.open,
				"aria-label": t("message.turnTime.title"),
				"data-turn-time": props.turn,
				onClick: () => {
					dialog.setOpen(!dialog.open);
				}
			}, h(IconClock, {}), h("span", {
				className: cls.triggerLabel
			}, t("message.ranFor", { duration: formatRunDuration(props.runMs, t) }))), dialog.open ? h(StatPanel, {
				panelRef: dialog.panelRef,
				pos: dialog.pos,
				title: t("message.turnTime.title"),
				icon: IconClock
			}, h("dl", {
				className: cls.panelDetails,
				"data-turn-time-details": props.turn
			}, h("dt", { key: "run" }, t("message.turnTime.duration")), h("dd", { key: "runv" }, formatRunDuration(props.runMs, t)), breakdown, props.tokensPerSecond !== void 0 ? h(Fragment, { key: "tps" }, h("dt", null, sub(t("message.turnTime.speed"))), h("dd", null, t("message.tokensPerSecond", { tps: formatTokensPerSecond(props.tokensPerSecond) }))) : null, props.ttftMs !== void 0 ? h(Fragment, { key: "ttft" }, h("dt", null, sub(t("message.turnTime.ttft"))), h("dd", null, t("duration.seconds", { seconds: formatLatencySeconds(props.ttftMs) }))) : null)) : null);
		}
		//#endregion
		//#region 会话统计行（接管官方 stats 单元格）
		function useWaitMs(sessionId, usage) {
			const [waitMs, setWaitMs] = react.useState(0);
			react.useEffect(() => {
				let live = true;
				fetchTurns(sessionId).then((body) => {
					if (live && body !== null && typeof body.totals?.waitMs === "number") setWaitMs(body.totals.waitMs);
				});
				return () => {
					live = false;
				};
			}, [sessionId, usage]);
			return waitMs;
		}
		function labelValue(label, value) {
			return label + " " + value;
		}
		function TimePill({ stats, waitMs, t, open, setOpen }) {
			const dialog = useStatDialog({
				open,
				setOpen
			});
			const counts = t("stats.counts", {
				turns: stats.turns,
				steps: stats.steps
			});
			const tps = stats.decodeMs > 0 ? t("message.tokensPerSecond", { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }) : null;
			/*
			 * 输入框下面那行只留「模型 1分1秒 · 工具 36秒 · 50 tok/s」——轮数/步数移进弹层标题，
			 * 省下的横向空间让用量 pill 能同时显示总 tok 与缓存命中率。
			 */
			const inline = [];
			/*
			 * 三者统一用「到分钟」的格式：秒位会随流式输出不停跳动，而且这一行要和
			 * 官方两枚 pill + 余额芯片挤在同一行里，数字越长越容易溢出换行。
			 */
			if (stats.llmMs > 0) inline.push(t("stats.llmShort", { duration: formatMinuteSpan(stats.llmMs, t) }));
			if (stats.toolMs > 0) inline.push(t("stats.toolShort", { duration: formatMinuteSpan(stats.toolMs, t) }));
			if (waitMs > 0) inline.push(t("stats.waitShort", { duration: formatMinuteSpan(waitMs, t) }));
			if (tps !== null) inline.push(tps);
			const label = inline.length > 0 ? inline.join(" · ") : counts;
			return h("span", {
				ref: dialog.rootRef,
				className: cls.anchor
			}, h("button", {
				type: "button",
				className: cls.pill,
				"aria-haspopup": "dialog",
				"aria-expanded": dialog.open,
				"aria-label": label,
				onClick: () => {
					dialog.setOpen(!dialog.open);
				}
			}, h(IconGauge, {}), h("span", {
				className: cls.pillLabel
			}, label)), dialog.open ? h(StatPanel, {
				panelRef: dialog.panelRef,
				pos: dialog.pos,
				title: t("stats.dialog.title"),
				icon: IconGauge,
				titleValue: counts
			}, h("dl", {
				className: cls.panelDetails,
				"data-session-stats-details": true
			}, stats.llmMs > 0 ? h(Fragment, { key: "llm" }, h("dt", null, t("stats.dialog.llmTime")), h("dd", null, formatDuration(stats.llmMs, t))) : null, stats.toolMs > 0 ? h(Fragment, { key: "tool" }, h("dt", null, t("stats.dialog.toolTime")), h("dd", null, formatDuration(stats.toolMs, t))) : null, waitMs > 0 ? h(Fragment, { key: "wait" }, h("dt", null, t("stats.waitUser")), h("dd", null, formatDuration(waitMs, t))) : null, stats.ttftSteps > 0 ? h(Fragment, { key: "ttft" }, h("dt", null, t("stats.dialog.ttft")), h("dd", null, formatDuration(stats.ttftMs / stats.ttftSteps, t))) : null, stats.decodeMs > 0 ? h(Fragment, { key: "tps" }, h("dt", null, t("stats.dialog.speed")), h("dd", null, t("message.tokensPerSecond", { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1e3)) }))) : null)) : null);
		}
		function UsagePill({ usage, t, open, setOpen }) {
			const dialog = useStatDialog({
				open,
				setOpen
			});
			const total = billedInputTokens(usage) + usage.outputTokens;
			const totalText = t("message.turnUsage.count", { count: formatTokens(total, t) });
			const cacheHit = sessionCacheHitPercent(usage);
			const cacheHitText = cacheHit !== null ? t("stats.cacheHit", { percent: cacheHit }) : null;
			return h("span", {
				ref: dialog.rootRef,
				className: cls.anchor
			}, h("button", {
				type: "button",
				className: cls.pill,
				"aria-haspopup": "dialog",
				"aria-expanded": dialog.open,
				"aria-label": cacheHitText === null ? totalText : totalText + " · " + cacheHitText,
				onClick: () => {
					dialog.setOpen(!dialog.open);
				}
			}, h(IconDatabase, {}), h("span", {
				className: cls.pillLabel
			}, h("span", { className: cls.pillGrow }, totalText), cacheHitText !== null ? h(Fragment, null, h("span", {
				className: cls.pillSep,
				"aria-hidden": true
			}, "·"), h("span", { className: cls.pillFixed }, cacheHitText)) : null)), dialog.open ? h(StatPanel, {
				panelRef: dialog.panelRef,
				pos: dialog.pos,
				title: t("stats.dialog.usageTitle"),
				icon: IconDatabase,
				titleValue: t("message.turnUsage.count", { count: formatExactTokens(total, t) })
			}, h("dl", {
				className: cls.panelDetails,
				"data-session-stats-usage": true
			}, cacheHit !== null ? h(Fragment, { key: "hit" }, h("dt", null, t("stats.cacheHitLabel")), h("dd", null, cacheHit + "%")) : null, h("dt", { key: "in" }, t("message.turnUsage.input")), h("dd", { key: "inv" }, t("message.turnUsage.count", { count: formatExactTokens(usage.uncachedInputTokens, t) })), h("dt", { key: "cr" }, t("message.turnUsage.cacheRead")), h("dd", { key: "crv" }, t("message.turnUsage.count", { count: formatExactTokens(usage.cacheReadTokens, t) })), usage.cacheWriteTokens !== 0 ? h(Fragment, { key: "cw" }, h("dt", null, t("message.turnUsage.cacheWrite")), h("dd", null, t("message.turnUsage.count", { count: formatExactTokens(usage.cacheWriteTokens, t) }))) : null, h("dt", { key: "out" }, t("message.turnUsage.output")), h("dd", { key: "outv" }, t("message.turnUsage.count", { count: formatExactTokens(usage.outputTokens, t) })))) : null);
		}
		/** 宿主没给 props.t 时的本地兜底翻译：用插件自带字典，保证组件不会因 t 缺失整棵崩掉。 */
		function localT(key, params) {
			const dict = zh !== void 0 ? zh : {};
			let text = typeof dict[key] === "string" ? dict[key] : key;
			if (params !== void 0 && params !== null) {
				for (const name of Object.keys(params)) text = text.split("{" + name + "}").join(String(params[name]));
			}
			return text;
		}
		/** 客户端代码版本标记：宿主日志里看到它就说明页面跑的是这一版。 */
		const CLIENT_BUILD = "v12-display-polish";
		/** 把客户端现场报给宿主（落盘到 ~/.dsh/balance-client-report.log）——不依赖浏览器控制台。 */
		function report(tag, info) {
			try {
				const url = "/api/balance/client-report?tag=" + encodeURIComponent(tag) + "&info=" + encodeURIComponent(String(CLIENT_BUILD + " " + info).slice(0, 400));
				fetch(url).catch(() => {});
			} catch {}
		}
		/** 渲染兜底：子组件抛错时记一笔（宿主日志可读）并返回 null，避免整棵子树消失。 */
		function safeRender(label, render) {
			try {
				return h(PillBoundary, { label }, render());
			} catch (error) {
				report("error:" + label, String(error?.stack ?? error).slice(0, 300));
				return null;
			}
		}
		/** 诊断：把 DOM 实况（位置/可见性/同一行里还有谁）写进 localStorage。 */
		function beaconDom(label, info) {
			try {
				localStorage.setItem("dsh-display-polish:dom:" + label, info + "@" + new Date().toISOString());
			} catch {}
		}
		/** 描述一个元素的类名与是否被 CSS 藏起来。 */
		function describeElement(element) {
			const name = String(element.className ?? element.tagName ?? "?");
			let hidden = "";
			try {
				const style = getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") hidden = "(hidden)";
			} catch {}
			return name.slice(0, 70) + hidden;
		}
		/** 诊断：把渲染情况写进 localStorage（宿主侧读得到），用于定位"注册成功但没渲染"。 */
		function beaconRender(label, detail) {
			try {
				localStorage.setItem("dsh-display-polish:render:" + label, detail + "@" + new Date().toISOString());
			} catch {}
		}
		/** 主机端 /api/balance/turns 的汇总：客户端拿不到 projection / 节点数据时的兜底数据源。 */
		function useSessionTotals(sessionId) {
			const [data, setData] = react.useState(null);
			react.useEffect(() => {
				let live = true;
				let timer;
				let attempts = 0;
				const read = (body) => {
					if (body === null || typeof body !== "object" || body.ok === false) return false;
					const totals = body.totals;
					if (totals === null || typeof totals !== "object") return false;
					setData({
						totals,
						turns: Array.isArray(body.turns) ? body.turns : []
					});
					return true;
				};
				const poll = () => {
					attempts += 1;
					fetchTurns(sessionId).then((body) => {
						if (!live) return;
						if (read(body)) return;
						if (attempts < 12) timer = setTimeout(poll, 3000);
					});
				};
				poll();
				return () => {
					live = false;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [sessionId]);
			return data;
		}
		const EMPTY_NODES = [];
		const selectChatNodes = (snapshot) => snapshot?.legacy?.nodes;
		const selectSessionNodes = (snapshot) => snapshot?.chat?.legacy?.nodes;
		const StatsPillsPlus = react.memo(function StatsPillsPlus(props) {
			const t = typeof props.t === "function" ? props.t : localT;
			const fromChat = typeof props.useChat === "function" ? props.useChat(selectChatNodes) : void 0;
			const fromSession = typeof props.useSession === "function" ? props.useSession(selectSessionNodes) : void 0;
			const settledNodes = fromChat ?? fromSession ?? EMPTY_NODES;
			const projectedUsage = typeof props.useProjection === "function" ? props.useProjection("tokenUsage") : void 0;
			const projected = typeof props.useProjection === "function" ? props.useProjection("sessionStats") : void 0;
			/*
			 * 0.2.0 的槽位不给 sessionId，但提供 useSession 这个会话 store hook
			 * （官方就是 useSession((s) => s.sessionId)）；旧版没有它时回落到 ctx.sessions 记录的当前会话。
			 */
			const storeSessionId = typeof props.useSession === "function" ? props.useSession((s) => (s === void 0 ? void 0 : s.sessionId)) : void 0;
			const sessionId = props.sessionId ?? storeSessionId ?? currentSessionId;
			const hostData = useSessionTotals(sessionId);
			const hostUsage = react.useMemo(() => {
				if (hostData === null || hostData.turns.length === 0) return void 0;
				let uncached = 0;
				let cacheRead = 0;
				let cacheWrite = 0;
				let output = 0;
				for (const turn of hostData.turns) {
					const detail = turn.detail;
					if (detail === void 0 || detail === null) continue;
					uncached += detail.uncachedInputTokens ?? 0;
					cacheRead += detail.cacheReadTokens ?? 0;
					cacheWrite += detail.cacheWriteTokens ?? 0;
					output += detail.outputTokens ?? 0;
				}
				return {
					uncachedInputTokens: uncached,
					cacheReadTokens: cacheRead,
					cacheWriteTokens: cacheWrite,
					outputTokens: output,
					totalTokens: uncached + cacheRead + cacheWrite + output
				};
			}, [hostData]);
			const usage = projectedUsage !== void 0 ? projectedUsage : hostUsage;
			const projectedStats = react.useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes]);
			const stats = projectedStats !== void 0 && (projectedStats.steps > 0 || projectedStats.llmMs > 0 || projectedStats.toolMs > 0 || projectedStats.waitMs > 0) ? projectedStats : hostData === null ? projectedStats : {
				steps: hostData.totals.steps,
				llmMs: hostData.totals.llmMs,
				toolMs: hostData.totals.toolMs,
				waitMs: hostData.totals.waitMs
			};
			const waitMs = useWaitMs(sessionId, usage);
			const [openPill, setOpenPill] = react.useState(null);
			const hasTokens = usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0);
			beaconRender("statsPills", "t=" + typeof props.t + " proj=" + typeof props.useProjection + " chat=" + typeof props.useChat + " session=" + typeof props.sessionId + " steps=" + (stats === void 0 ? -1 : stats.steps) + " tokens=" + (hasTokens ? 1 : 0));
			report("props:statsPills", "useSession=" + typeof props.useSession + " useProjection=" + typeof props.useProjection + " sessionId=" + String(sessionId) + " steps=" + (stats === void 0 ? -1 : stats.steps) + " hasTokens=" + (hasTokens ? 1 : 0));
			react.useEffect(() => {
				try {
					const mine = document.querySelector("[data-composer-stats]");
					if (mine === null) {
						beaconDom("statsPills", "not-mounted");
						return;
					}
					const rect = mine.getBoundingClientRect();
					const style = getComputedStyle(mine);
					const row = mine.parentElement;
					const kids = row === null ? [] : [...row.children].map(describeElement);
					const domInfo = "rect=" + Math.round(rect.width) + "x" + Math.round(rect.height) + "@" + Math.round(rect.left) + "," + Math.round(rect.top) + " display=" + style.display + " vis=" + style.visibility + " opacity=" + style.opacity + " rowKids=" + kids.length + " [" + kids.join(" | ") + "]";
					beaconDom("statsPills", domInfo);
					report("dom:statsPills", domInfo);
				} catch (error) {
					beaconDom("statsPills", "err " + (error?.message ?? error));
				}
			}, []);
			const variant = props.variant;
			const timePill = stats !== void 0 && stats.steps > 0 ? safeRender("StatsTimePill", () => h(TimePill, {
				key: "time",
				stats,
				waitMs,
				t,
				open: openPill === "time",
				setOpen: (open) => {
					setOpenPill(open ? "time" : null);
				}
			})) : null;
			const usagePill = hasTokens ? safeRender("StatsUsagePill", () => h(UsagePill, {
				key: "usage",
				usage,
				t,
				open: openPill === "usage",
				setOpen: (open) => {
					setOpenPill(open ? "usage" : null);
				}
			})) : null;
			/*
			 * 0.2.1 的 dock 拆成两个条目（activity / usage），每个条目只渲染自己那枚 pill，
			 * 直接以「裸 anchor」形态嵌进 dock 那一行（与官方 pill 同构）。
			 * 0.1.5 / 0.2.0 只有一个 stats 条目，仍走下面「整行两枚」的旧形态。
			 */
			if (variant === "time" || variant === "usage") {
				const pill = variant === "time" ? timePill : usagePill;
				if (pill === null) return null;
				return h("span", {
					className: cls.anchor,
					"data-composer-stats": variant === "time" ? true : void 0
				}, pill);
			}
			if (timePill === null && usagePill === null) return null;
			return h("div", {
				className: cls.pillsRoot,
				"data-composer-stats": true
			}, timePill, usagePill);
		});
		//#endregion
		//#region 每轮收尾操作行：合并后的两枚 pill（list 槽，纯新增）
		let currentSessionId = void 0;
		/** 由 messageId 反查收尾节点（其 data 同时带该轮 tokenUsage / ttft / TPS）。 */
		function turnTailForMessage(snapshot, messageId) {
			if (snapshot === void 0 || snapshot === null || messageId === void 0) return void 0;
			const store = snapshot.nodes;
			if (store === void 0 || store === null || typeof store.values !== "function") return void 0;
			for (const node of store.values()) {
				if (node === null || typeof node !== "object" || node.kind !== "turn-tail") continue;
				const finalNode = node.data?.closing?.finalNode;
				if (finalNode !== undefined && finalNode !== null && finalNode.messageId === messageId) return node;
			}
			return void 0;
		}
		const selectTurnTailForMessage = (messageId) => (snapshot) => turnTailForMessage(snapshot, messageId);
		const TurnPills = react.memo(function TurnPills(props) {
			const t = typeof props.t === "function" ? props.t : localT;
			const messageId = props.messageId;
			const storeSessionId = typeof props.useSession === "function" ? props.useSession((s) => (s === void 0 ? void 0 : s.sessionId)) : void 0;
			const sessionId = props.sessionId ?? storeSessionId ?? currentSessionId;
			const selector = react.useMemo(() => selectTurnTailForMessage(messageId), [messageId]);
			const node = typeof props.useChat === "function" ? props.useChat(selector) : void 0;
			const data = node === void 0 ? void 0 : node.data;
			const location = node === void 0 ? void 0 : node.location;
			const turnLocation = location !== void 0 && location !== null && (location.kind === "turn" || location.kind === "step") ? location.turn : void 0;
			/* 桌面版 0.2.0：assistant-actions 只传 messageId，useChat 的 store 形状也不同，
			   节点可能查不到；此时改从收尾行的 data-turn-tail 上读轮次（两版都有这个属性）。 */
			const [domTurn, setDomTurn] = react.useState(void 0);
			const storeTurn = turnLocation === void 0 || turnLocation === null ? void 0 : turnLocation.turn;
			const turn = storeTurn !== void 0 ? storeTurn : domTurn;
			const entry = useTurnEntry(sessionId, turn, messageId);
			/*
			 * 0.2.0 的 assistant-actions 槽只传 messageId：useChat 查不到收尾节点是常态。
			 * 轮次来源依次为「节点 location → data-turn-tail（挂载后回填）→ 主机端按 messageId 反查」，
			 * 主机端 /api/balance/turns 每轮都带 messageIds，所以总有一路能拿到轮次。
			 */
			const resolvedTurn = turn !== void 0 ? turn : entry === null || entry === void 0 ? void 0 : entry.turn;
			const wrapperRef = react.useRef(null);
			/* 总用时：优先节点里的 turn 起止；0.2.0 拿不到节点时用主机端 turn/start→turn/end 算出的 runMs。 */
			const runMs = turnLocation !== void 0 && turnLocation !== null && turnLocation.start !== void 0 && turnLocation.end !== void 0 ? Math.max(0, turnLocation.end.time - turnLocation.start.time) : entry?.runMs;
			const hasUsage = data?.tokenUsage !== void 0 || entry !== null;
			/* 本轮 pill 是否真的渲染出来：只有渲染了才给收尾行打标记去隐藏官方那两枚。 */
			const show = resolvedTurn !== void 0 && (hasUsage || runMs !== void 0);
			beaconRender("turnPills", "t=" + typeof props.t + " session=" + typeof sessionId + " node=" + (node === void 0 ? 0 : 1) + " turn=" + (resolvedTurn === void 0 ? -1 : resolvedTurn) + " entry=" + (entry === null ? 0 : 1) + " runMs=" + (runMs === void 0 ? -1 : runMs) + " usage=" + (hasUsage ? 1 : 0));
			/*
			 * 收尾行标记 + 轮次回填：
			 *  - 只在 show 为真时给行打 data-statsline-turn-pills（CSS 据此隐藏官方 pill）；
			 *  - 同时从最近的 [data-turn-tail] 读轮次，补上 0.2.0 里 useChat 查不到节点的情况。
			 * 依赖 [show, resolvedTurn]，于是「空跑一次拿到轮次 → 再渲染出 pill」能收敛。
			 */
			react.useEffect(() => {
				const wrapper = wrapperRef.current;
				if (wrapper === null) return;
				const slot = wrapper.parentElement;
				const row = slot === null ? null : slot.parentElement;
				if (row !== null) {
					if (show) row.setAttribute("data-statsline-turn-pills", "");
					else row.removeAttribute("data-statsline-turn-pills");
				}
				const owner = typeof wrapper.closest === "function" ? wrapper.closest("[data-turn-tail]") : null;
				const raw = owner === null ? null : owner.getAttribute("data-turn-tail");
				if (raw !== null && raw !== void 0 && raw.length > 0) {
					const parsed = Number(raw);
					if (Number.isFinite(parsed) && parsed !== resolvedTurn) setDomTurn(parsed);
				}
				try {
					const rect = wrapper.getBoundingClientRect();
					const style = getComputedStyle(wrapper);
					const kids = row === null ? [] : [...row.children].map(describeElement);
					const domInfo = "rect=" + Math.round(rect.width) + "x" + Math.round(rect.height) + "@" + Math.round(rect.left) + "," + Math.round(rect.top) + " display=" + style.display + " vis=" + style.visibility + " owner=" + (owner === null ? "none" : "ok") + " show=" + (show ? 1 : 0) + " turn=" + (resolvedTurn === void 0 ? -1 : resolvedTurn) + " rowKids=" + kids.length + " [" + kids.join(" | ") + "]";
					beaconDom("turnPills", domInfo);
					report("dom:turnPills", domInfo);
				} catch (error) {
					beaconDom("turnPills", "err " + (error?.message ?? error));
				}
				return () => {
					if (row !== null) row.removeAttribute("data-statsline-turn-pills");
				};
			}, [show, resolvedTurn]);
			/*
			 * 即使暂时没有数据也要渲染这层 display:contents 的壳：有壳上面那个 effect 才跑得到，
			 * 才能读到 [data-turn-tail] 回填轮次（上一版先 return null，壳不存在 → 永远回填不了 → 每轮 pill 永不出现）。
			 */
			return h("span", {
				ref: wrapperRef,
				style: { display: "contents" }
			}, show && hasUsage ? safeRender("TurnUsagePanel", () => h(TurnUsagePanel, {
				t,
				turn: resolvedTurn ?? entry?.turn,
				tokenUsage: data?.tokenUsage,
				entry
			})) : null, show && runMs !== void 0 ? safeRender("TurnTimePanel", () => h(TurnTimePanel, {
				t,
				turn: resolvedTurn ?? entry?.turn,
				runMs,
				/* 主机端从完整事件日志算出的 TTFT/TPS 不受「已加载窗口」限制，优先使用。 */
				tokensPerSecond: entry?.tokensPerSecond ?? data?.tokensPerSecond,
				ttftMs: entry?.ttftMs ?? data?.ttftMs,
				entry
			})) : null);
		});
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale", "sessions"];
		function apply(ctx) {
			report("apply", "client plugin applied");
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-display-polish: dictionaries");
			const syncSession = () => {
				try {
					const snapshot = ctx.sessions.list.getSnapshot();
					currentSessionId = snapshot?.current;
				} catch {
					currentSessionId = void 0;
				}
			};
			syncSession();
			ctx.effect(() => {
				syncSession();
				const unsubscribe = ctx.sessions.list.subscribe(syncSession);
				return () => unsubscribe();
			}, "dsh-display-polish: session tracker");
			/**
			 * 注册槽位条目：先直接注册（槽位已声明时立刻生效），失败则按 250ms 重试，
			 * 最多 60 次（15 秒）——覆盖 ui-conversation / ui-chat 声明槽位的先后差异。
			 * 不依赖 slots.inject 的回调时机。
			 */
			const registerSlot = (scope, options, component, label) => {
				const slots = scope.slots;
				let disposable;
				let timer;
				let attempts = 0;
				const attempt = () => {
					if (disposable !== void 0) return;
					attempts += 1;
					try {
						disposable = slots.register(options, component);
						report("registered", label);
						try {
							localStorage.setItem("dsh-display-polish:beacon", label + "@" + new Date().toISOString());
						} catch {}
						return;
					} catch (error) {
						if (attempts === 1 || attempts % 20 === 0) console.warn("[dsh-display-polish] " + label + " 待槽位声明（第 " + attempts + " 次）：", error?.message ?? error);
						if (attempts < 60) timer = setTimeout(attempt, 250);
					}
				};
				scope.effect(() => () => {
					if (timer !== void 0) clearTimeout(timer);
					if (disposable !== void 0) disposable();
				}, label);
				attempt();
			};
			/*
			 * 只依赖 slots：0.2.0 起客户端不再提供 "conversation" 服务
			 * （ui-conversation 改用 uiSession.provide），继续 inject 它会永远等不到，
			 * 整个注册回调就不会执行 —— 插件看上去「没生效」。
			 */
			ctx.inject(["slots"], (scope) => {
				/*
				 * 官方 dock 的条目 id 随版本变过：
				 *   0.2.1 起：id "activity"（轮/步 + tok/s）与 id "usage"（token + 缓存命中），两个条目；
				 *   0.1.5 / 0.2.0：只有一个 id "stats"。
				 * 同一 id 上「priority 更低者渲染」，所以在两个 id 上各注册一个 -1 就能把官方两枚顶掉；
				 * 如果只按老 id 注册，官方两枚会照常出现 —— 一行里就有「插件 + 官方」两套 pill，直接溢出。
				 * 先看槽位当前的占位者决定用哪套 id，两套版本都能用。
				 */
				const dockIds = (() => {
					try {
						const snapshot = typeof scope.slots.snapshot === "function" ? scope.slots.snapshot("conversation.composer.dock") : void 0;
						const occupants = Array.isArray(snapshot) && snapshot.length > 0 && Array.isArray(snapshot[0].occupants) ? snapshot[0].occupants : [];
						if (occupants.some((item) => item !== null && typeof item === "object" && item.id === "activity")) return ["activity", "usage"];
						if (occupants.some((item) => item !== null && typeof item === "object" && item.id === "stats")) return ["stats"];
					} catch {}
					return ["activity", "usage"];
				})();
				dockIds.forEach((dockId, dockIndex) => {
					const variant = dockId === "activity" ? "time" : dockId === "usage" ? "usage" : void 0;
					const component = variant === void 0 ? StatsPillsPlus : (props) => h(StatsPillsPlus, {
						...props,
						variant
					});
					registerSlot(scope, {
						name: "conversation.composer.dock",
						id: dockId,
						priority: -1,
						order: dockIndex,
						locale: NS,
						registrant: "dsh-display-polish"
					}, component, "dsh-display-polish: dock pill " + dockId);
				});
				// list 槽的新 id：纯新增，官方产物链 / 收尾动作 / 反馈按钮一概不动。
				registerSlot(scope, {
					name: "conversation.chat.assistant-actions",
					id: "turn-cost",
					order: -10,
					locale: NS,
					registrant: "dsh-display-polish"
				}, TurnPills, "dsh-display-polish: turn pills");
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
