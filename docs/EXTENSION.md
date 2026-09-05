# Sovereignty Chromium companion

This is an unaudited development extension. Use invented credentials only until an independent security audit. It is self-hosted and uses the existing unlocked web vault; it does not implement a second decrypted vault or send a vault to a login page.

## Build and install

Use Node.js 24+ and pnpm 11.24.0. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @svrgn/extension build
pnpm --filter @svrgn/extension test
pnpm --filter @svrgn/extension-protocol test
pnpm --filter @svrgn/extension typecheck
pnpm --filter @svrgn/extension package
```

`--frozen-lockfile` rejects dependency drift; `--filter` selects the workspace package. Build outputs `apps/extension/dist`, ready for **chrome://extensions → Developer mode → Load unpacked**. Select that directory. Rebuild, then use the extension's Reload button after changes. Package also builds and writes `apps/extension/sovereignty-chromium.zip`; Python 3 is required for packaging. The ZIP uses sorted paths, fixed timestamps and permissions, and uncompressed entries for reproducibility independent of compression-library versions. SHA-256 is printed. No store publication occurs.

## Pair and fill

1. Pin Sovereignty in the browser toolbar. On a synthetic login page, open its popup.
2. Enter your vault origin, including its explicit port when needed. HTTPS is required except for `http://localhost` and `http://127.0.0.1`. A URL path, query, or fragment is normalized away. Raw HTTP tailnet addresses are rejected. For container development use the actual allocated localhost preview port.
3. Select **Pair vault**. Sovereignty opens that exact origin in a new tab with a one-time pairing fragment. Unlock the vault and explicitly approve the companion request within 60 seconds.
4. Return to the login tab and open the popup. Select **Refresh matches**. Only exact origin matches appear: scheme, canonical hostname, and non-default port must all match. Subdomains are separate origins. Unicode hostnames are compared through URL punycode normalization; lookalikes are never treated as equivalents. URLs with credentials, trailing dots, whitespace, backslashes or unsupported schemes are rejected.
5. Select a login form if more than one is eligible, then explicitly select **Fill** beside the desired account within ten seconds. Only that username/password pair is sent to the top document. Nothing submits automatically. Review the page before submitting.
6. Disconnect in the popup or lock the web vault to revoke the session. It also ends when the vault tab disconnects, the worker restarts, or five minutes elapse. Keep the unlocked companion tab open while testing.

The popup includes a cryptographic 24-character password generator (144 random bits, uniform 64-symbol alphabet). Generated text clears from the UI after 30 seconds or popup closure; focus selects it for ordinary keyboard copy. Clipboard contents are user-controlled and are not automatically rewritten. Buttons, form choice, inputs, and status messages are keyboard accessible.

## Permissions and trust boundaries

| Manifest entry | Justification |
| --- | --- |
| `activeTab` | Temporary access to the tab where the user opens the action; browser-derived URL and explicit script injection. No persistent access to browsing history. |
| `scripting` | Inject the bundled content script only into frame 0 of that active tab on Refresh. No remote scripts. |
| `storage` | Persist only the configured nonsecret vault origin in `storage.local`; access is restricted to trusted extension contexts. No credentials, keys, master passwords, pairing tokens or sessions are stored. |
| `externally_connectable.matches` | HTTPS sites and HTTP localhost/127.0.0.1 can attempt direct companion connections because the self-hosted hostname is configurable. This is inbound messaging eligibility, not host access. Every actual connection is additionally pinned to the exact configured origin and newly opened tab. `ids` is omitted, denying other extensions. |

There are no host permissions, `<all_urls>`, `tabs`, clipboard, webRequest, telemetry, network fetch, remote code, automatic content-script matches, or web-accessible resources. The extension CSP permits bundled scripts only. Chromium's documented [external messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) and [externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable) APIs are the trusted transport; there is no `window.postMessage` bridge.

### Pairing and requests

The background generates a random UUIDv4 (122 random bits) pairing capability and embeds it in the fragment of the exact configured origin. It binds the capability to the browser-created tab ID, frame 0, sender URL, sender origin, and a 60-second deadline. The web page must present it once on the `svrgn-companion-v1` external port. A random page cannot choose the paired tab, forge Chrome's sender fields, or present a capability it did not receive. Same-origin compromised vault JavaScript remains inside the vault trust boundary; this protocol does not protect against a compromised self-hosted vault server or vault XSS. Fragments are not sent as HTTP request targets, but browser history and any vault-origin script can see them before the web page removes them.

Only the exact internal popup URL, matching runtime extension ID, and absence of a sender tab authorize internal list/fill requests. Content scripts cannot request lists or choose an origin. The worker gets the active URL from Chrome, injects frame 0, records Chrome's document ID, and addresses subsequent messages to that document ID. It uses random single-use request IDs with explicit ten-second deadlines and rejects unsolicited, duplicate, oversized or malformed responses. The web independently validates these requests and matches current unlocked records by exact origin. List replies contain at most 50 matching item IDs, titles and usernames, never passwords.

A single-use popup fill capability binds session identity, tab ID, document ID, origin, listed item IDs, eligible form handles and expiry. The worker rechecks the active tab/origin/session after every credential await and checks the original grant deadline before dispatch. A navigation cannot receive a message addressed to an older document. Disconnect rejects pending requests and clears capabilities. Service-worker suspension/restart fails closed: memory sessions disappear and pairing is required again.

Before requesting metadata or secrets, the worker requires a live content port
registration whose Chrome-supplied sender ID, tab, frame 0, document ID, active
lifecycle and effective origin match the injected target. A sandboxed document's
URL can look trusted while its effective origin is opaque; that registration is
rejected. Registration alone has no list/fill authority. Disconnect, navigation,
lock and worker restart invalidate it. The content script additionally rejects
an effective origin that differs from its normalized URL origin.

### Page/content threat model

Treat the target page and content script as hostile. Neither can authorize a credential request. A compromised content script can lie about eligible form handles, but only receives the one credential that the user selected for the browser-derived exact top-level origin; it cannot obtain another origin's credential or a whole vault. The page necessarily reads any values intentionally filled into its DOM. There is no protection against malicious scripts already running on the selected matching origin.

The isolated content script uses its own DOM references, not page-provided CSS selectors. It considers only visible, writable inputs in the same top-level form, with exactly one recognizable username/email field and one password field, and a same-origin form action. Hidden, disabled, readonly, inert, transparent, zero-size and disabled-fieldset fields are excluded. Multiple eligible forms have separate random handles; ambiguous fields are refused. Before filling it rechecks expiry, origin, identity, connectivity, form ownership and visibility. DOM replacement invalidates references. Both values are set before input/change events, so a username listener cannot redirect the second write. The script never submits. Embedded cross-origin and sandboxed frames are not traversed; shadow DOM, multi-step forms and ambiguous multi-password flows are unsupported.

Plaintext credentials exist only during message handling and the selected DOM write. The worker releases its credential reference immediately after Chrome serializes the message, before awaiting the page; acknowledgements are bounded by the original grant deadline. Content exceptions also release references; form handles expire. JavaScript strings, messaging copies, garbage collection and browser internals prevent guaranteed memory zeroization. Locking before dispatch cancels the operation; locking after dispatch cannot retract values already delivered to an authorized page. These limits require review in the independent audit.

## Browser fixture and verification

`apps/extension/fixtures/login.html` includes benign separate forms, hidden inputs, ambiguous fields, an adversarial action, sandboxed frames, and controls that replace or disable a discovered form. Serve it with the managed preview workflow from `apps/extension`:

```sh
dev-preview start sovereignty-extension-fixture --health-path /fixtures/login.html -- pnpm exec vite --host '{host}' --port '{port}' --strictPort
```

`--health-path` selects the fixture because this workspace has no root index page. `--host` and `--port` receive the manager's allocation; `--strictPort` refuses occupied ports instead of moving. Append `/fixtures/login.html` to the reported local URL for the shared browser, and use the manager's tailnet URL for the user. Keep the main vault preview running. Check the accessibility tree, console, network, both form choices, changed DOM rejection, locking, and keyboard controls. Close every browser page you open. Never launch an alternate browser stack.

The fixture exposes `window.sovereigntyFixture.discover()` and `fill(handle)` for browser automation of the actual `FormDiscovery` module with fixed synthetic values only. That fixture API is not bundled into the extension. Unit tests cover URL adversaries, exact schemas, oversized data, sender spoofing, replay/expiry, worker restart, active-tab changes, lock during fill, form visibility/identity, and multi-form selection. Actual extension loading and real Chrome external messaging must be verified separately; passing mocks is not evidence of successful installed extension behavior.

`fixtures/popup.html` renders the actual popup against a visibly labelled synthetic
runtime for keyboard, layout, expiry, and state testing. It never connects to a
vault and is excluded from the extension build. The fixture server allocated port
4045 in the development container; Chrome rejects that port as unsafe. Browser
checks instead used the existing web Vite preview's development-only file serving
at `/@fs/home/node/repos/svrgn/apps/extension/fixtures/login.html` and
`/fixtures/popup.html` under the same file directory, on port 4044. No network
configuration was changed. The unused fixture server was stopped.

On 2026-09-05 Chrome verified the two benign form choices, selection of the second
form without changing the first, replay rejection, DOM replacement and readonly
rejection, popup keyboard fill, state changes and origin-draft preservation.
The popup fixture had no console errors or failed/external network requests.
The installed-extension ceremony remains unverified: the approved browser upload
tool rejected both the worktree and repository unpacked directories as outside
its configured workspace roots. Fix that tool configuration or manually load
`apps/extension/dist` before claiming installed Chromium integration.

## Portability and remaining work

Pure protocol, generator, form discovery and serialization validation are independent of Chrome API calls. The `background.ts` and thin `content.ts`/popup messaging adapters contain Chromium integration. Firefox requires an explicit adapter, manifest conversion, Promise/event parity checks, and a different reviewed companion transport: ordinary webpage `runtime.connect` external messaging is not assumed available. Do not advertise this package as Firefox-compatible.

Save-new-login and update-existing-login prompts need a separately reviewed, user-approved capture protocol and bounded plaintext lifetime. A submit event does not prove authentication succeeded, so this version neither silently captures passwords nor claims to detect successful login. Multi-step forms, native desktop companionship, macOS secure storage and Expo/iOS credential providers remain later milestones. No native signing, app-store enrollment, extension-store submission or production deployment is included.
