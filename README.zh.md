# dsh-display-polish

[English](README.md) | 中文

给 DeepSeek Harness（DSH）Web GUI 的官方用量 pill 做**金额**与**用时**的精修：
不改变官方外观，把精度和明细做细。

- **对话栏下方那行**（输入框下面的统计行）：接管官方单元格，外观一致但读数更细 ——
  模型 / 工具 / 等待用户 用时分开，缓存命中率两位小数，另附 tok/s。
- **每轮收尾行**：在官方时间戳左边（官方用量 pill 原来的位置）放两枚 pill ——
  「本轮 0.4836 元」（本轮花费，4 位小数）与「用时 1分23秒」；官方那枚用量 pill 会被隐藏，
  两者不会重复显示。
- **花费明细弹层**：提供方 / 模型、缓存命中率、各分桶的 token **及其金额**
  （未缓存输入 / 缓存输入 / 缓存写入 / 输出，推理作为「输出」的子行），
  然后是工具调用总额 + 按工具 / 按 step 明细，最后是**子工具汇总** ——
  \`run_code\` 内部真正执行的每个工具（pwsh / read / edit / grep …）的次数与它分摊到的金额。
- **用时明细弹层**：本轮总用时拆成 模型 / 工具 / 等待用户 / 询问 / 其他，另含 TTFT、TPS。
- 弹层位置与官方 stat-dialog 一致：底边贴在触发 pill 上方一点，高度固定，
  工具链再长也在面板内部滚动，不会把面板撑高。

## 环境要求

- DeepSeek Harness **0.2.0-rc.2** 及以上（Web GUI 或官方桌面客户端）。
  0.1.5 上同一份代码也能跑，只是用不到桌面版那套 messageId → 轮次 的兜底。

## 安装

\`\`\`sh
dsh plugin --profile desktop add https://github.com/L-jh40/dsh-display-polish
# 或者从 npm 安装
dsh plugin --profile desktop add dsh-display-polish
\`\`\`

重启宿主（桌面版：托盘右键退出后再启动），刷新页面即可，无需任何配置。

## 实现要点

- 在 \`conversation.composer.dock\` 以 id \`stats\`、priority \`-1\`（最低者渲染）接管官方统计单元格。
- 在 \`conversation.chat.assistant-actions\` 注册两个 list 条目；CSS 把它们排到官方
  「时间 / 收尾信息块」之前（也就是官方用量 pill 的位置）并隐藏官方用量 pill ——
  但只在插件自己的 pill 真的渲染出来时才隐藏，插件失效会自动退回官方显示。
- 弹层用 \`createPortal\` 挂到 \`document.body\`，并沿用官方
  \`--dsw-specific-menu\` / \`--dsw-menu-backdrop-filter\` 令牌，外观与行为都与官方一致。
- 金额口径与宿主一致；按工具 / 按子工具的金额都是「本步金额按调用次数分摊」。

## 说明

- 客户端产物是手写的（\`lib/client.js\`，无构建步骤），经 \`window.__ModuleLoader__\` 加载；
  \`lib/index.js\` 是空转的宿主行。
- 0.2.0 把 \`@deepseek-ai/dsh-client-ui-primitives\` 的图标导出改了名
  （\`Icon*16\` → \`Icon*Regular\` / \`Icon*Medium\`）；本插件用回退链解析图标，
  并给每枚 pill 套了 React 错误边界，改名不会再让整块静默消失。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
