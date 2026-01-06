# Pre-Execution Analysis — UI Mock Concept

**Status:** Analysis Only  
**Date:** 2026-01-06  
**Parent:** `ENTERPRISE_ANALYSIS_DASHBOARD_CONCEPT.md`

---

## Overview

This document defines a read-only UI for inspecting automation artifacts **before** any execution occurs.

**Core principle:** Surface mismatches and consent gaps as first-class risk signals.

---

## UI Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PRE-EXECUTION ANALYSIS                                         [Read-Only] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SECTION 1: Artifact Identity                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SECTION 2: Declared vs Effective Behavior                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SECTION 3: Consent Requirements Matrix                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SECTION 4: Risk Analysis Summary                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SECTION 5: Ingress/Egress Path Analysis                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SECTION 6: AI Involvement Breakdown                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 1: Artifact Identity

### Purpose

Display immutable identifiers and metadata for the artifact under inspection.  
Establish chain-of-custody from source to current state.

### Example Data (Mocked)

| Field | Value |
|-------|-------|
| **Artifact Type** | Template |
| **ID** | `tpl_7f3a9b2c1d4e5f6a` |
| **Name** | "Invoice Processing Workflow" |
| **Version** | `2.1.0` |
| **Author** | `publisher:acme-corp` |
| **Created** | `2026-01-03T14:22:31Z` |
| **Content Hash** | `sha256:a1b2c3d4e5f6...` |
| **Signature** | `✓ Valid (acme-corp.pub)` |
| **Source** | `registry.opengiraffe.io/acme/invoice-processor` |

### Risk Signals

| Signal | Condition | Display |
|--------|-----------|---------|
| ⚠️ Unsigned | No valid signature | Yellow badge |
| 🔴 Hash Mismatch | Content hash differs from registry | Red badge + click for diff |
| ⚠️ Outdated | Newer version available | Yellow badge with version delta |
| ✅ Verified | Signature valid, hash matches | Green badge |

---

## Section 2: Declared vs Effective Behavior

### Purpose

Compare what the artifact **claims** to do (README, description, metadata) against what the automation graph **actually** does.

### Example Data (Mocked)

#### Declared Behavior (from README/metadata)

```
This template:
- Depackages invoice capsule from parent session
- Extracts line items from attached artefacts
- Validates totals against stored purchase order context
- Packages approval result as new capsule
```

#### Detected Behavior (from automation graph analysis)

| Step | Operation | Declared | Match |
|------|-----------|----------|-------|
| 1 | Depackage capsule from session | ✅ Yes | ✅ |
| 2 | Extract artefact text via OCR | ✅ Yes | ✅ |
| 3 | Query external API: `api.taxrates.io` | ❌ No | 🔴 **UNDECLARED** |
| 4 | Validate against session context (PO data) | ✅ Yes | ✅ |
| 5 | Package approval capsule | ✅ Yes | ✅ |
| 6 | POST to `analytics.acme.com` | ❌ No | 🔴 **UNDECLARED** |

### Risk Signals

| Signal | Condition | Display |
|--------|-----------|---------|
| 🔴 Undeclared Operation | Step exists in graph but not in README | Red row highlight |
| ⚠️ Missing Implementation | Declared in README but no matching step | Yellow row |
| 🔴 External Call Undeclared | Network egress not documented | Red badge + endpoint shown |
| ✅ Full Alignment | All steps match declarations | Green summary badge |

### Click-Through Reasoning

Clicking on any mismatch row opens detail panel:

```
┌──────────────────────────────────────────────────────────────┐
│ MISMATCH DETAIL                                              │
├──────────────────────────────────────────────────────────────┤
│ Step: 3                                                      │
│ Operation: HTTP GET to api.taxrates.io/v2/lookup             │
│                                                              │
│ Why flagged:                                                 │
│ • No mention of tax rate lookup in README                    │
│ • No mention of external API calls in template description   │
│ • Endpoint domain not in declared egress list                │
│ • Template claims to use only session context for validation │
│                                                              │
│ Automation graph location: steps[2].action.http              │
│ README scan: 0 matches for "tax", "rate", "api.taxrates"     │
│ Manifest egress list: ["smtp.relay.internal"]                │
└──────────────────────────────────────────────────────────────┘
```

---

## Section 3: Consent Requirements Matrix

### Purpose

Display all consent gates required before execution.  
Show current consent status for each requirement.

### Example Data (Mocked)

| Consent Type | Requirement | Status | Granted By | Timestamp |
|--------------|-------------|--------|------------|-----------|
| **Human Approval** | Manager sign-off for amounts > $10,000 | ⏳ Pending | — | — |
| **Policy Gate** | `policy:data-export-allowed` | ✅ Passed | System | 2026-01-06T09:14:22Z |
| **Policy Gate** | `policy:external-api-allowed` | 🔴 Failed | System | 2026-01-06T09:14:22Z |
| **Receiver Consent** | Recipient email opt-in | ✅ Confirmed | recipient@example.com | 2026-01-05T16:30:00Z |
| **Data Subject** | Invoice sender consent for processing | ⏳ Pending | — | — |

### Consent Dependency Graph

```
                    ┌─────────────────┐
                    │ Execution Start │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Policy:    │  │ Policy:    │  │ Human:     │
     │ data-export│  │ external-  │  │ Manager    │
     │ ✅ Passed  │  │ api 🔴Fail │  │ ⏳ Pending │
     └────────────┘  └────────────┘  └────────────┘
```

### Risk Signals

| Signal | Condition | Display |
|--------|-----------|---------|
| 🔴 Policy Failed | Required policy gate returned deny | Red badge, blocks execution |
| ⏳ Pending Human | Human approval required, not yet granted | Yellow badge |
| ⚠️ Expired Consent | Consent granted but TTL exceeded | Yellow badge with expiry time |
| ✅ All Granted | All consent requirements satisfied | Green summary badge |

---

## Section 4: Risk Analysis Summary

### Purpose

Aggregate all risk signals into a single dashboard view.  
Provide severity ranking and click-through to source.

### Example Data (Mocked)

#### Risk Score Card

```
┌─────────────────────────────────────────────────────────────┐
│ OVERALL RISK LEVEL                                          │
│                                                             │
│              ████████████████░░░░░░░░░░  HIGH (72/100)      │
│                                                             │
│ Blocking Issues: 2                                          │
│ Warnings: 3                                                 │
│ Passed Checks: 14                                           │
└─────────────────────────────────────────────────────────────┘
```

#### Risk Factor Breakdown

| Category | Score | Issues | Top Issue |
|----------|-------|--------|-----------|
| **Documentation Alignment** | 45/100 | 2 undeclared operations | External API call to taxrates.io |
| **Consent Coverage** | 60/100 | 1 failed, 2 pending | Policy `external-api-allowed` denied |
| **Ingress/Egress Paths** | 30/100 | 2 undeclared egress | analytics.acme.com not in manifest |
| **AI Involvement** | 90/100 | 0 issues | All AI steps have fallback handlers |

### Click-Through Reasoning

Each category row expands to show:

```
┌──────────────────────────────────────────────────────────────┐
│ DOCUMENTATION ALIGNMENT — DETAIL                             │
├──────────────────────────────────────────────────────────────┤
│ Score: 45/100 (HIGH RISK)                                    │
│                                                              │
│ Calculation:                                                 │
│ • Total steps in automation graph: 6                         │
│ • Steps with README coverage: 4                              │
│ • Undeclared steps: 2                                        │
│ • Coverage ratio: 66.7%                                      │
│ • Penalty: Undeclared external calls (-30 points)            │
│                                                              │
│ Recommendation:                                              │
│ Author should update README to document:                     │
│ • Tax rate lookup via api.taxrates.io                        │
│ • Analytics reporting to analytics.acme.com                  │
└──────────────────────────────────────────────────────────────┘
```

---

## Section 5: Ingress/Egress Path Analysis

### Purpose

Map all data flow paths — both **external** (network, filesystem) and **internal** (session imports, capsule depackaging).  
Compare declared paths against detected paths.

**Important distinction:**
- Capsules are typically **passive containers** — they don't trigger direct ingress in most cases
- Ingress often occurs through **orchestrator actions**: session import, capsule depackaging, context injection
- Egress includes both external calls and internal state mutations

### Example Data (Mocked)

#### Ingress Paths

| Path | Type | Source | Declared | Detected | Status |
|------|------|--------|----------|----------|--------|
| Session import | Internal | Orchestrator context | ✅ Yes | ✅ Yes | ✅ Match |
| Capsule depackaging | Internal | Parent capsule `cap_8a7b...` | ✅ Yes | ✅ Yes | ✅ Match |
| Attached artefact extraction | Internal | BEAP envelope | ✅ Yes | ✅ Yes | ✅ Match |
| User-provided context | Internal | Session variable injection | ❌ No | ✅ Yes | ⚠️ Undeclared |
| External API response | External | `api.taxrates.io` | ❌ No | ✅ Yes | 🔴 **Undeclared** |

#### Egress Paths

| Path | Type | Target | Declared | Detected | Status |
|------|------|--------|----------|----------|--------|
| Session state update | Internal | Orchestrator context | ✅ Yes | ✅ Yes | ✅ Match |
| Capsule packaging | Internal | New capsule creation | ✅ Yes | ✅ Yes | ✅ Match |
| Local storage write | Internal | IndexedDB / SQLite | ✅ Yes | ✅ Yes | ✅ Match |
| Email notification | External | SMTP relay | ✅ Yes | ✅ Yes | ✅ Match |
| `api.taxrates.io` | External | HTTP GET | ❌ No | ✅ Yes | 🔴 **Undeclared** |
| `analytics.acme.com` | External | HTTP POST | ❌ No | ✅ Yes | 🔴 **Undeclared** |

### Data Flow Topology View

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│   INTERNAL INGRESS                           EXTERNAL EGRESS              │
│   ┌─────────────────┐                        ┌─────────────────┐          │
│   │ Session Import  │ ──┐                 ┌──│ SMTP Relay      │ ✅       │
│   │ Capsule Depack  │ ──┼──┐              │  └─────────────────┘          │
│   │ Artefact Extract│ ──┘  │              │  ┌─────────────────┐          │
│   └─────────────────┘      ▼              │  │ api.taxrates.io │ 🔴       │
│                      ┌───────────┐        │  └─────────────────┘          │
│                      │ TEMPLATE  │────────┤  ┌─────────────────┐          │
│                      │ EXECUTION │        │  │ analytics.acme  │ 🔴       │
│                      └───────────┘        │  └─────────────────┘          │
│                            │              │                               │
│   INTERNAL EGRESS          │              │  EXTERNAL INGRESS             │
│   ┌─────────────────┐      │              │  ┌─────────────────┐          │
│   │ Session Update  │ ◀────┘              └──│ API Response    │ 🔴       │
│   │ Capsule Create  │                        └─────────────────┘          │
│   │ Local Storage   │                                                     │
│   └─────────────────┘                                                     │
│                                                                           │
│   Legend: 🔴 = Undeclared    ✅ = Declared    ── = Data flow              │
└───────────────────────────────────────────────────────────────────────────┘
```

### Risk Signals

| Signal | Condition | Display |
|--------|-----------|---------|
| 🔴 Undeclared External Egress | HTTP call to domain not in manifest | Red node in topology |
| 🔴 Undeclared External Ingress | Data received from undeclared external source | Red node |
| ⚠️ Undeclared Internal Flow | Session/capsule operation not documented | Yellow indicator |
| ⚠️ Cross-Capsule Reference | Template references capsule not in declared dependencies | Yellow badge |
| ✅ Closed System | All internal and external paths declared | Green topology outline |

### Note on Capsule Passivity

```
┌──────────────────────────────────────────────────────────────┐
│ ℹ️  CAPSULE INGRESS MODEL                                    │
├──────────────────────────────────────────────────────────────┤
│ Capsules are passive containers. They do not initiate        │
│ ingress operations directly.                                 │
│                                                              │
│ Ingress occurs when:                                         │
│ • Orchestrator imports a session containing the capsule      │
│ • Another automation depackages the capsule                  │
│ • User action triggers capsule inspection                    │
│                                                              │
│ The paths shown above represent what the TEMPLATE declares   │
│ it will do when executed — not what the capsule does on      │
│ its own.                                                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Section 6: AI Involvement Breakdown

### Purpose

Identify which steps involve AI/LLM processing vs deterministic logic.  
Highlight AI steps without fallback handlers.

### Example Data (Mocked)

#### Step Classification

| Step | Name | Type | AI Model | Fallback | Status |
|------|------|------|----------|----------|--------|
| 1 | Read attachments | Deterministic | — | — | ✅ |
| 2 | OCR extraction | AI | `tesseract-local` | ✅ Manual input | ✅ |
| 3 | Tax rate lookup | Deterministic | — | — | ✅ |
| 4 | Line item classification | AI | `llama3:8b` | ✅ Default category | ✅ |
| 5 | Approval decision | AI | `gpt-4o` | ❌ None | 🔴 **No Fallback** |
| 6 | Send notification | Deterministic | — | — | ✅ |

#### AI Involvement Summary

```
┌─────────────────────────────────────────────────────────────┐
│ AI STEP RATIO                                               │
│                                                             │
│ Deterministic: ████████████████████  4 steps (67%)          │
│ AI-Assisted:   ██████████             2 steps (33%)          │
│                                                             │
│ AI Steps with Fallback:    2/3 (67%)                        │
│ AI Steps without Fallback: 1/3 (33%) ⚠️                     │
└─────────────────────────────────────────────────────────────┘
```

### Risk Signals

| Signal | Condition | Display |
|--------|-----------|---------|
| 🔴 No Fallback | AI step has no fallback handler defined | Red badge on step |
| ⚠️ Remote Model | AI step uses cloud-hosted model (data leaves local) | Yellow badge |
| ⚠️ High Token Cost | Step estimated to consume >10k tokens | Yellow cost indicator |
| ✅ Local + Fallback | AI step uses local model with fallback | Green badge |

### Click-Through: AI Step Detail

```
┌──────────────────────────────────────────────────────────────┐
│ AI STEP DETAIL — Step 5: Approval Decision                   │
├──────────────────────────────────────────────────────────────┤
│ Model: gpt-4o (OpenAI, remote)                               │
│ Estimated tokens: 2,500 input / 150 output                   │
│ Data sent: Invoice line items, totals, vendor name           │
│                                                              │
│ Fallback handler: ❌ NONE DEFINED                            │
│                                                              │
│ Risk explanation:                                            │
│ • If model is unavailable, step will fail                    │
│ • No human escalation path defined                           │
│ • Workflow will halt at this step                            │
│                                                              │
│ Recommendation:                                              │
│ Define fallback: route to human approver queue               │
└──────────────────────────────────────────────────────────────┘
```

---

## Section 7: Mismatch Summary Panel

### Purpose

Aggregate all mismatches into a single actionable list.  
First-class visibility for discrepancies.

### Example Data (Mocked)

| # | Category | Mismatch | Severity | Location |
|---|----------|----------|----------|----------|
| 1 | Behavior | External API call not documented | 🔴 High | Step 3 |
| 2 | Behavior | Analytics egress not documented | 🔴 High | Step 6 |
| 3 | Consent | Policy `external-api-allowed` denied | 🔴 Blocking | Policy Engine |
| 4 | Consent | Human approval pending | ⚠️ Medium | Consent Gate |
| 5 | Ingress | User-provided session context undeclared | ⚠️ Medium | Session injection |
| 6 | AI | Approval step has no fallback | ⚠️ Medium | Step 5 |

### Mismatch Click-Through Template

Each row expands to:

```
┌──────────────────────────────────────────────────────────────┐
│ MISMATCH #1                                                  │
├──────────────────────────────────────────────────────────────┤
│ Category: Behavior Alignment                                 │
│ Severity: HIGH                                               │
│                                                              │
│ What was declared:                                           │
│   README mentions: "Depackages capsule, validates, packages" │
│   Manifest egress: ["smtp.relay.internal"]                   │
│                                                              │
│ What was detected:                                           │
│   Step 3 performs: HTTP GET to api.taxrates.io               │
│   Domain api.taxrates.io not in manifest egress list         │
│                                                              │
│ Why this matters:                                            │
│   • Undeclared external calls may leak data                  │
│   • Policy cannot evaluate unknown endpoints                 │
│   • Audit trail incomplete without declaration               │
│                                                              │
│ Evidence:                                                    │
│   Graph path: workflow.steps[2].action.http.url              │
│   Value: "https://api.taxrates.io/v2/lookup"                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Visual Design Notes

### Color Semantics

| Color | Meaning |
|-------|---------|
| 🔴 Red | Blocking issue, execution should not proceed |
| 🟠 Orange | High-risk warning, requires attention |
| 🟡 Yellow | Medium-risk warning, review recommended |
| 🟢 Green | Passed check, no issues detected |
| ⚪ Gray | Informational, no risk implication |

### Interaction Model

- **Read-only** — No edit buttons, no save actions
- **Click-through** — Every risk signal expands to reasoning
- **Copy hashes** — All hash values have copy-to-clipboard icon
- **Collapsible sections** — Default to expanded for critical, collapsed for passed

### Typography

- **Monospace** for: Hashes, IDs, file paths, code references
- **Sans-serif** for: Labels, descriptions, risk explanations
- **Bold** for: Section headers, severity levels
- **Subdued** for: Timestamps, metadata

---

*End of Pre-Execution Analysis UI Mock.*

