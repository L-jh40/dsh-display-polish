/**
 * dsh-display-polish host half — a minimal cordis plugin row so the profile
 * loader mounts this package and the client-modules scanner picks up the
 * `dsh.client` browser bundle. All real behavior lives in the client half
 * (lib/client.js): it shadows the official stats cell
 * (conversation.composer.dock id 'stats') and adds the per-turn
 * cost / duration pills. No host service, no routes, no settings.
 * @module dsh-display-polish
 */
/** Stable cordis plugin name (display/roster only; the loader spec is the package name in cordis.patch.yml). */
const name = 'display-polish'
/** No host services required. */
const inject = []
/** No host-side work. */
function apply() {}
export { apply, inject, name }
