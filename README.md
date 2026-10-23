# dsh-display-polish

English | [中文](README.zh.md)

## 中文说明 · 这个插件做什么

**用量与用时显示优化**：给 DeepSeek Harness（DSH）Web GUI 官方的用量 pill 做「金额」与「用时」的精修，
不改变官方外观，只把精度和明细做细。

- **对话栏下方那行**：模型 / 工具 / 等待 用时统一显示到分钟（秒位会跳动，也防一行里挤太多字），
  缓存命中率两位小数，另附 tok/s。
- **每轮收尾行**：在官方时间戳左边放「本轮 0.4836 元」（4 位小数花费）与「用时 1分23秒」，
  并隐藏官方那枚重复的用量 pill（只有插件自己的 pill 真渲染出来时才隐藏）。
- **花费弹层**：提供方 / 模型、缓存命中率、各分桶 token 及金额（推理作为输出子行），
  工具调用按工具与「步」给明细，末尾汇总 \`run_code\` 内部各子工具的调用次数与分摊金额。
- **用时弹层**：总用时拆成 模型 / 工具 / 等待用户 / 询问 / 其他，另含 TTFT 与 TPS。
- **弹层形态**：挂到 body、底边贴触发 pill 上方、高度固定（工具链再长也在面板内滚动），与官方 stat-dialog 一致。
- **版本适配**：0.2.1（官方 dock 拆成 \`activity\` / \`usage\` 两个条目）与 0.2.0 及更早（单 \`stats\` 条目）都支持。

Finer **money** and **time** readouts for the DeepSeek Harness (DSH) Web GUI: this
plugin polishes the official usage pills instead of leaving them at the default
granularity.

- **Composer stats cell** (the line under the input box) is taken over with the
  official look and a finer readout: model / tool / wait-for-user time split,
  cache-hit rate to two decimals, tokens-per-second.
- **Per-turn pills** next to the official timestamp: `本轮 0.4836 元` (this turn's
  cost, 4 decimals) and `用时 1分23秒`, in the exact place the official usage pill
  used to sit — the official one is hidden so the two never duplicate each other.
- **Cost detail popover**: provider / model, cache-hit rate, per-bucket tokens
  **and their money split** (uncached input / cache read / cache write / output,
  reasoning shown as a sub-line of output), then the tool-call total with a
  per-tool and per-step breakdown, and a final **sub-tool summary** — every tool
  actually executed inside `run_code` (pwsh / read / edit / grep / …) with its
  call count and the share of the step cost it accounts for.
- **Duration popover**: total run time split into model / tool / wait-for-user /
  ask-wait / other, plus TTFT and TPS.
- Panel placement matches the official stat dialog: anchored just above the
  trigger pill with a fixed height, so a long tool chain scrolls inside the
  panel instead of resizing it.

## Requirements

- DeepSeek Harness **0.2.0-rc.2** or newer (Web GUI or the official desktop
  client). On 0.1.5 the same code runs but the desktop-specific fallbacks
  (messageId -> turn lookup) are not needed.

## Installation

```sh
dsh plugin --profile desktop add https://github.com/L-jh40/dsh-display-polish
# or from npm
dsh plugin --profile desktop add dsh-display-polish
```

Restart the host (desktop client: quit from the tray, then start it again) and
refresh the page. The plugin is zero-config.

## How it works

- Registers into `conversation.composer.dock` with id `stats` at priority `-1`
  (lowest priority renders), which shadows the official stats cell.
- Registers two list entries into `conversation.chat.assistant-actions`; CSS
  moves them in front of the official end-info block (where the timestamp lives)
  and hides the official usage pill — but only while the plugin's own pills are
  actually rendered, so a failure falls back to the official pills instead of
  showing nothing.
- The popover is portaled to `document.body` and uses the official
  `--dsw-menu-backdrop-filter` / `--dsw-specific-menu` tokens, so it looks and
  behaves exactly like the official stat dialog.
- Money uses the same pricing the host computes; per-tool and per-sub-tool money
  is the step cost split by call count.

## Notes

- The client bundle is hand-written (`lib/client.js`, no build step) and loaded
  through `window.__ModuleLoader__`; `lib/index.js` is a no-op host row.
- 0.2.0 renamed the `@deepseek-ai/dsh-client-ui-primitives` icon exports
  (`Icon*16` -> `Icon*Regular` / `Icon*Medium`); the plugin resolves them through a
  fallback chain and wraps every pill in a React error boundary, so a rename can
  no longer make the whole entry disappear silently.

## License

MIT — see [LICENSE](LICENSE).
