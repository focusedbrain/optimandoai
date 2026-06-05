# FIX-SPEC A+B report — Hermetic worker bundle + rig provisioning (docs/build-specs/0022)

Reports the build for spec `0021`. **Part A is green and verified.** **Part B is
executed as far as unprivileged access allows; the durable-access + reboot-survival
legs are operator-gated (sudo / reboot) and remain OPEN — reported, not absorbed.**

Machine: AMD Ryzen 5 3550H · Ubuntu 24.04.4 LTS · host kernel **`6.17.0-35-generic`**
(was `6.17.0-29-generic` at Build 2a) · 8 SVM threads. Date: 2026-06-05.

---

## Part A — Hermetic worker bundle (GREEN)

### What changed
- `buildWorkerBundle.mjs` is now **hermetic**: esbuild version **pinned + asserted**
  (`0.21.5`, fail-loud on mismatch — INV-7); esbuild's per-module **path-banner
  comments stripped** post-build (the only location-sensitive output — they vary
  with cwd / symlinked `node_modules`); `sourcemap:false`, fixed `target:node18`,
  fixed `charset:utf8`, LF, no minify, `legalComments:none`. The strip pattern
  `^// <single-token-path>.(c?[jt]s|mjs)$` matches **only** esbuild banners, never
  the library's own inline/prose comments (which are indented and/or contain spaces).
- The bundle is now a **committed reproducible reference artifact**
  (`dist/worker-bundle.cjs`) plus `dist/worker-bundle.provenance.json` (sha256 of
  every bundled input, lockfile hash, esbuild version, build-script self-hash).
  Both are force-tracked (a parent `.gitignore` excludes all `dist/` dirs).
- `smokeTest.mjs` now exercises **all three guest parse paths**.
- `0009` **V0 upgraded** from "type a hash" to **rebuild-and-diff**: clean checkout
  → `pnpm install --frozen-lockfile` → run the script → `git diff --exit-code` on
  `dist/`. Re-blessing a hash was rejected as risk routing. Reference hash recorded
  once, with `0021` cited; superseded `f7310ffd…` / `cb04ae51…` marked do-not-use.

### Determinism evidence
| Proof | Command | Result |
|---|---|---|
| Double-build identity | run script twice, `cmp` | **IDENTICAL** — both `68374091…` (bundle and provenance) |
| Banners stripped | `grep -cE '^// \S+\.(c?[jt]s\|mjs)$'` | **0** residual |
| Change-detection (real) | string-literal probe in `guestEntry.ts`, rebuild | bundle → `eaec684a…` (**DIFFERS**, change detected) |
| Restore | revert probe, rebuild | back to `68374091…` (**IDENTICAL**) |
| V0 gate end-to-end | rebuild + `git diff --exit-code -- …/rig/dist/` | **exit 0, clean** |
| 3-path bare-Node smoke | `node …/rig/smokeTest.mjs` | **PASS** — `depackage`, `depackage-email/rfc822`, `depackage-email/structured-json` |

**Reference artifact:** `sha256(dist/worker-bundle.cjs) = 68374091f7bf5683d33dc7a41e64a027b1ddb39bba3d60b0877f4899b07cc177`

> A standalone comment probe was tried first and did **not** change the output
> (esbuild drops such comments), which would have made the change-detection proof a
> false negative — so the proof uses a string literal that is guaranteed to appear
> in the emitted bundle. Noted for honesty.

---

## Part B — Rig provisioning

### History answer (the question asked first)
**This is the same physical mini-PC that ran Build 2a** — CPU (Ryzen 5 3550H),
distro (Ubuntu 24.04.4), and Rust (1.96.0) all match `rig/README.md`, and the
Build-2a user-dir artifacts survive. The README's historical "VERIFIED" entries
**do describe this hardware.** What has drifted since 2026-06-03:

| Item | State now | Implication |
|---|---|---|
| crosvm **source** (`~/build/crosvm`) | **present**, HEAD `938fc36` (matches README) | README path was `~/build/crosvm`, not `~/crosvm` (why the earlier probe missed it) |
| crosvm **binary** (`target/release/crosvm`) | **present** (built 2026-06-03), but **not on PATH** | only needed installing onto PATH, not rebuilding |
| Golden image (`~/build/rig/golden-base.ext4`, `vmlinuz`, `vsock-host-client`) | **present** (Build-2a, `-29` kernel) | refreshable; needed the new Part-A bundle embedded |
| Host kernel | **upgraded** `6.17.0-29` → `6.17.0-35` | guest image kernel+modules must stay self-consistent; `-29` vmlinuz+modules still present and readable, so the refresh pins `KREL=6.17.0-29-generic` |
| `kvm` group | konge **NOT** a member; `/dev/kvm` works via a per-user ACL only | durable fix = group membership (operator/sudo) |
| `/dev/vhost-vsock` | exists (group `kvm`); **konge ACL absent this boot** despite the persistent udev rule existing | the udev RUN ACL did not apply this boot; blocks the vsock smoke |
| udev rule `99-wrdesk-vhost-vsock.rules` | **present** (root, Build-2a) | rule exists but is not reliably applying — see deviation D-B2 |

Verdict: **same hardware, lost only the crosvm-binary-on-PATH and the
runtime device access; kernel point-upgraded.** Not a reinstall, not a different box.

### Executed (unprivileged, no sudo)
| Step | Action | Result |
|---|---|---|
| crosvm restore | `install -m755 ~/build/crosvm/target/release/crosvm ~/.local/bin/crosvm` | on PATH; `crosvm --help` exit 0 |
| crosvm boot | `crosvm-launch.sh hello` (KVM only) | **guest booted**: "HELLO-CROSVM guest is up", clean power-down, exit 0, ~1s |
| Image refresh | `KREL=6.17.0-29-generic build-golden-image.sh` | rebuilt `golden-base.ext4` embedding the **new** Part-A bundle |
| Embedded-bundle check | `debugfs dump … ; cmp` | embedded `/opt/worker/worker-bundle.cjs` == committed reference (`68374091…`) |
| vsock binaries | compiled by the image build | `vsock-job-server` staged in image; `vsock-host-client` at `~/build/rig` |
| `build-golden-image.sh` | added a deterministic `KREL` env override (rig tooling only) | documented; defaults to `$(uname -r)` |

### Provenance table
| Component | Pin / version | Hash |
|---|---|---|
| crosvm | commit `938fc36e34c0122db028f4b9cd2a3477fff604f7`, Rust 1.96.0, `--no-default-features --features qcow` | `sha256(~/.local/bin/crosvm)=083e4749e856a3bc1f27b3c80591c623ed7643db6acf1efe027a2451a62f27af` |
| esbuild | `0.21.5` (asserted by build script) | n/a |
| worker bundle | hermetic reference | `68374091f7bf5683d33dc7a41e64a027b1ddb39bba3d60b0877f4899b07cc177` |
| golden image | `KREL=6.17.0-29-generic`, Node v22.22.0 + bundle above | `sha256(golden-base.ext4)=a344d7da241a96c171139e46c7a3f1db15e4d9d4907eb10d40e2883fe5f80ea3` (rig-local, not committed; ext4 metadata makes this informational, not a reproducibility gate) |
| lockfile | `code/pnpm-lock.yaml` | `00121cf7100f69602e8d52462f3608b84e0ff74ae981d32b5bf32eff54906bff` |

### Reboot-survival proof — **NOT OBTAINED (operator-gated)**
The proof Part B requires (post-reboot, session user runs the smoke without sudo)
**cannot be produced from this automated session**: it needs `sudo` (which requires
an interactive password here) and a real reboot of the operator's machine. The
unprivileged-only attempt at the full vsock smoke fails **closed**, exactly:

```
crosvm] exiting with error 1: failed to set up virtual socket device
  0: failed to open virtual socket device /dev/vhost-vsock
  1: Permission denied (os error 13)
```

The remaining operator steps (in `rig/PROVISIONING.md` §1/§3) are:
```bash
sudo usermod -aG kvm "$USER"                                   # durable kvm-group membership
echo vhost_vsock | sudo tee /etc/modules-load.d/wrdesk-vhost-vsock.conf
sudo udevadm control --reload && sudo modprobe vhost_vsock \
  && sudo udevadm trigger --name-match=vhost-vsock            # apply the existing ACL rule now
# then REBOOT, log in, and verify (no sudo): kvm group + /dev/kvm rw + /dev/vhost-vsock rw,
# then: cd …/rig && bash crosvm-launch.sh worker   (+ a trivial CrosvmProvider job)
```

---

## Deviations (reported, NOT absorbed)

- **D-A1 — pnpm, not npm.** The spec's canonical procedure says `npm ci`. This repo
  uses **pnpm** (`code/pnpm-lock.yaml`; `node_modules` at `code/`); there is no
  `package-lock.json`. Implemented as `pnpm install --frozen-lockfile` (the
  frozen-lockfile equivalent of `npm ci`) and documented as such in `0009` V0 and
  the build-script header.
- **D-A2 — bundle force-tracked.** A parent `.gitignore`
  (`code/apps/electron-vite-project/.gitignore: dist`) excludes all `dist/` dirs, so
  a child negation cannot re-include the artifact. The reference bundle + provenance
  are committed via `git add -f`; once tracked, rebuilds surface as normal diffs
  (which is what the V0 rebuild-and-diff relies on).
- **D-B1 — Part B not fully green (durable access + reboot survival OPEN).** Group
  membership, the boot-time vhost_vsock load, and the post-reboot unprivileged smoke
  require sudo + a reboot unavailable to this session. Executed everything else;
  exact operator commands are in `rig/PROVISIONING.md` and above. The full vsock
  smoke is **BLOCKED**, not passed.
- **D-B2 — existing udev rule not applying this boot.** `99-wrdesk-vhost-vsock.rules`
  is installed but konge's ACL on `/dev/vhost-vsock` is absent this boot. The
  durable recommendation is `kvm`-group membership (both `/dev/kvm` and
  `/dev/vhost-vsock` are group `kvm`), with the udev ACL as belt-and-suspenders;
  `PROVISIONING.md` §3 reflects this.
- **D-B3 — image kernel pinned to `-29`.** Because the host kernel was point-upgraded
  to `-35` (whose `/boot/vmlinuz-6.17.0-35` is root-only-readable) while the surviving
  guest image + `-29` modules + readable `-29` vmlinuz are self-consistent, the refresh
  pinned `KREL=6.17.0-29-generic`. A future refresh on `-35` only needs the operator to
  `sudo chmod +r /boot/vmlinuz-6.17.0-35-generic` (host-setup-root.sh §3 does this).
- **D-B4 — `crosvm` reinstalled, not rebuilt.** The 2a binary survived at the pinned
  commit, so it was installed onto PATH rather than rebuilt from scratch. Commit
  recorded; `PROVISIONING.md` documents the full build for a from-scratch machine.

---

## Status
- **Part A: GREEN** — committed, V0 rebuild-and-diff clean, three-path smoke PASS.
- **Part B: PARTIAL** — crosvm operational, image refreshed with the Part-A bundle,
  binaries built; **durable device access + reboot-survival smoke are OPEN on the
  operator.** The V-series rerun (out of scope here) needs Part B fully green AND the
  IMAP account (O's action item).
