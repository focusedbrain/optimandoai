# WR Code test build

A test build of the desktop app has a built-in WR Code test registry: six test publishers with signed catalogs, directory records and DNS answers, served inside the app. Every WR Code you enter resolves through the real six gates against this test data. Nothing talks to a server, and nothing needs a certificate or an environment variable.

The registry is `apps/electron-vite-project/electron/main/wrc/wrcTestRegistry.ts`. It follows WRC contract v2.0 as the client implements it today (`docs/spec/WRC-Registry-API-Contract_Delta_v2.0.md`).

## Build and run

From `code/apps/electron-vite-project`:

```
pnpm run build:wrc-test
```

This runs the normal build with the test registry compiled in. The app goes to its own folder, so an existing release build stays where it is:

| | Release build (`pnpm run build`) | Test build (`pnpm run build:wrc-test`) |
|---|---|---|
| Windows | `C:\build-output\build007\win-unpacked\WRDeskT.exe` | `C:\build-output\build007-wrc-test\win-unpacked\WRDeskT.exe` |
| Linux | `dist/release/linux-unpacked/` | `dist/release-wrc-test/linux-unpacked/` |

Both builds are the same app with the same user data (account, handshakes, vault). Only WR Code differs. Every screen of the test build shows the banner "WR Code test build: every WR Code resolves against built-in test publishers, not real ones", and it cannot be dismissed. The main-process log shows `[WRC] TEST REGISTRY ACTIVE` on first use, and `wrc.runtimeStatus` reports `testRegistry: true`.

## Where WR Codes are entered

Open any message in the inbox and click **WR Code** in the message toolbar. The panel opens above the message body:

- **Enter a WR Code:** type or paste a code. While you type, a local format check shows the recognized code ("Valid format: …"); nothing is looked up yet. **Check** runs the six gates.
- **Find WR Codes in this message:** shown only when the message's sender is authenticated by the mail channel (DKIM or SPF aligned pass). The app decides this in the main process from the message's sealed provenance record; for any other message the panel says it is not scanned, and you can still type a code. Found codes appear as buttons; clicking one checks it.
- **Result:** either the offer (the publisher's signed value statement, publisher, verified domain, code, next steps) with **Accept** and **Decline**, or a status explaining why the code cannot be used, with the gate and reason code as a secondary line.
- Checking another code, closing the panel or opening another message declines an offer you left open, so a one-time offer is not held for the 10-minute claim timeout.

## Who you are in the test build

- You act for **Test Publisher B** (`TEST02`), the own test publisher, as party `test-party-1` on device `test-party-1:this-device`.
- Your signed-in account's e-mail domain is registered, live, as a DNS-proven domain of `TEST02`. That lets your real session pass the Gate-2 e-mail check and receive the C and SC codes below.
- WR Code submission and acceptance need an active SSO session, as in every build.

## Test codes

The expected outcome is the result of a first submission. Enter the codes with or without hyphens, in any letter case.

| Code | What it is | Expected outcome |
|---|---|---|
| `P-TEST01-10001N` | Published offering (Test Publisher A) | passes all six gates |
| `P-TEST01-10005X` | One-time offering (Test Publisher A) | passes all six gates; after acceptance, a new submission is refused at Gate 3 with `CONSUMED` |
| `P-TEST01-10002K` | Offering suspended by the platform (Test Publisher A) | Gate 3: `entry_platform_suspended` |
| `P-TEST01-10003H` | Offering suspended by the publisher (Test Publisher A) | Gate 3: `entry_suspended` |
| `P-TEST01-10004Z` | Retired offering (Test Publisher A) | Gate 3: `entry_retired` |
| `I-TEST01-200001-T` | Internal handshake addressed to you (Test Publisher A) | passes all six gates |
| `I-TEST01-200002-W` | Internal handshake addressed to someone else (Test Publisher A) | Gate 4: `NOT_FOR_YOU` |
| `SP-TEST01-300001-G` | Sub-handshake beneath the published offering (Test Publisher A) | passes all six gates |
| `SE-TEST01-400001-B` | Session sub-handshake, session valid (Test Publisher A) | passes all six gates |
| `SE-TEST01-400002-D` | Session sub-handshake, session expired (Test Publisher A) | Gate 3: `entry_expired` |
| `C-TEST01-TEST02-V` | Cross-organization handshake to your publisher (Test Publisher A) | passes all six gates |
| `SC-TEST01-500001-W` | Sub-handshake beneath the cross-organization handshake (Test Publisher A) | passes all six gates |
| `P-TEST03-100011` | Offering (Inactive Test Publisher) | Gate 2: `namespace_inactive` |
| `P-TEST04-10001J` | Offering (Revoked Test Publisher) | Gate 2: `namespace_revoked` |
| `P-TEST05-10001R` | Offering (Superseded Test Publisher) | Gate 2: `namespace_superseded`, successor `TEST01` shown |
| `P-TEST06-100016` | Offering (Compromised Test Publisher) | Gate 2: `namespace_compromised`, with the unsuppressible warning |
| `P-TEST01-199992` | Unknown offering of Test Publisher A | Gate 3: `entry_unknown` (capture error) |
| `P-TEST09-10001F` | Unknown publisher | Gate 2: `namespace_unknown_identifier` (capture error) |
| `P-TEST01-100010` | Typing error: the published offering with a wrong check character | Gate 1: `check_failed` (capture error) |

`wrc/__tests__/wrcTestRegistry.test.ts` runs every code through the six gates and fails if an outcome changes; `wrcBuildFlavor.guard.test.ts` fails if this table misses a code.

Not covered yet: device-bound SI and SC codes (they need seeded Device Records), relay-released capsules (Gate 5/6 wire, S7), and the §XVI.6.4 `connector` field (client work C4).

## Starting over

Test state is kept apart from real state: the test build uses `wrc-security.wrc-test.db` next to the normal `wrc-security.db` (under `%USERPROFILE%\.opengiraffe\electron-data\`, or the folder of `WRDESK_WRC_SECURITY_DB`), and `wrc-resolved-publishers.wrc-test.json` in the app's user data folder. To use the one-time offering again, close the app and delete those two files.

## Why this cannot leak into a release

- A release build replaces the registry module with an empty stub (`wrcTestRegistry.release-stub.ts`, aliased in `vite.config.ts`), and `scripts/verify-wrc-build-flavor.cjs` fails every build chain whose release bundle still contains the registry.
- A release build takes its WR Code trust only from `wrc/wrcTrustAnchors.ts`, never from environment variables, and refuses any pinned anchor whose key id starts with `test-`.
- Every test key id starts with `test-`, and every test domain is under the reserved `.test` top-level domain.
