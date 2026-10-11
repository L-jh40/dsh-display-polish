# dsh-display-polish

English | [中文](README.zh.md)

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
