# AMENDMENT 1 to the B1 ruling — pipeline separation, INV-6 correction, kind rename

Apply this before (or, if already committed, immediately on top of) the §3 doc-patch commits of the B1 ruling. B1's build scope (§2) is otherwise unchanged.

## 1. Two pipelines — document this as the governing structure

The seam serves two fully separate pipelines, and the docs must say so explicitly:

- **Email depackaging pipeline:** provider API pulls raw mail → `depackage` (MIME parse in the isolation boundary; SafeTextV1 + sealed original artifacts) → a BEAP capsule is created from the result. Key-less for content. This is the depackaging unit's / appliance's entire job. `open-link` and `view-attachment` belong to this untrusted-content family.
- **Native BEAP pipeline:** wire qBEAP/pBEAP packages from counterparties — arriving over P2P, relay, coordination WS, **or carried inside an email** — → `validate-native-beap` (structural) → qBEAP post-quantum decryption → decrypted-content validation → seal → insert.

`detectAndRouteMessage` is the **fork point** between the two (a provider email is either plain mail → pipeline 1, or a BEAP carrier → pipeline 2). The historical conflation existed because email is also a BEAP transport, so one function inlined both pipelines. Replace the "conflation paragraph" instruction from the B1 ruling §3.1 with this two-pipeline statement.

## 2. INV-6 is corrected — do NOT write the previous wording into the docs

Strike: "BEAP capsule decryption is not a seam job kind and will not become one."

Replace with: **INV-6 (key-locality): key-requiring jobs are local-only. They execute at the key holder, never route to any node that lacks the keys, and never execute on the appliance (which is content-key-less by design). The key holder's most-isolated venue is a local, zero-egress, per-action microVM; in-process inside the sandbox VM is the free-tier floor.**

Accordingly, a dedicated seam kind `decrypt-qbeap` is **planned** (pipeline 2): on paid/Linux it will run in a local zero-egress per-action microVM with per-job key provisioning (keys delivered via the job channel, memory-only, never written to the overlay); free tier runs it in-process inside the sandbox VM. **It is NOT implemented in B1** — reserve the enum value with `supports() === false` everywhere and a doc note, nothing more. The decrypt blocks in `messageRouter.ts`/`beapEmailIngestion.ts` remain untouched in B1 exactly as ruled.

INV-2 is refined to match: vault-derived seal keys never leave the host process (unchanged); no key material ever crosses to a remote node or the appliance (unchanged); handshake decryption keys MAY be provisioned into a **local** zero-egress per-action microVM for `decrypt-qbeap` (mechanics are a future build — out of B1 scope). Note in the docs that `view-attachment` is also key-requiring (artifact custody key) and therefore INV-6-local to the custody holder.

## 3. Kind rename — eliminate the conflated name

Rename `'validate-depackaged'` → `'validate-decrypted-beap'` (it wraps `validateDecryptedBeapContent`; it belongs to the native BEAP pipeline, not the email pipeline). Mechanical rename across Build A's seam module, table, and tests; the B1 cutover sites use the new name. Then annotate every kind in `types.ts` with its pipeline:

- Email/untrusted-content pipeline: `depackage`, `open-link`, `view-attachment`
- Native BEAP pipeline: `validate-native-beap`, `decrypt-qbeap` (reserved, unimplemented), `validate-decrypted-beap`

INV-1's refined structural rule from the B1 ruling maps onto the pipelines cleanly: the absolute workstation in-process ban covers the untrusted-content kinds; the transitional workstation rule covers the two implemented validate kinds; `decrypt-qbeap` (when it arrives) will be governed by INV-6 key-locality plus the same boundary rules.

## 4. Confirmation required

Reply confirming: (a) whether the §3 doc patch had already been committed with the old INV-6 wording (if so, the correcting commit lands before any §2 cutover work), (b) the rename is applied, (c) B1 §2 scope proceeds unchanged. List any new questions this amendment raises before coding.
