# Analysis Dashboard — Global UI System Rules

**Status:** Analysis Only  
**Date:** 2026-01-06  
**Applies To:** All dashboard phases (Pre-Execution, Live, Post-Execution)

---

## 1. Core Principles

### 1.1 Determinism

> Same input → Same output → Same display

| Rule | Implementation |
|------|----------------|
| No randomness in display | No random colors, no random ordering |
| Stable sorting | Always sort by deterministic key (timestamp, ID, hash prefix) |
| Reproducible layout | Same data produces identical layout every session |
| No client-side inference | Display only what the system recorded — never infer |

**Anti-pattern to avoid:**
```
❌ "The system detected suspicious activity"  (inference)
✅ "Step 3 accessed undeclared endpoint: api.example.com"  (fact)
```

### 1.2 Transparency

> Every displayed value must be traceable to its source

| Rule | Implementation |
|------|----------------|
| Show provenance | Every value has a "source" indicator |
| No hidden transformations | If data is processed, show the transformation |
| Explicit uncertainty | Unknown values shown as `[UNKNOWN]`, never guessed |
| Full hash visibility | All hashes displayed in full with copy button |

**Anti-pattern to avoid:**
```
❌ Risk Score: 72 (no explanation)
✅ Risk Score: 72 [click to see calculation: 4 undeclared ops × 15 + 2 missing consents × 6]
```

### 1.3 Auditability

> An external auditor can verify any claim the UI makes

| Rule | Implementation |
|------|----------------|
| Export everything | All displayed data exportable as JSON/CSV |
| Hash-based verification | Any hash can be verified against source |
| Immutable audit trail | Append-only event log backing every record |
| External tool compatibility | Export formats parseable by standard tools |

**Auditor test:** Can an auditor with only the export file verify every claim?

### 1.4 Upgrade Safety

> Adding new verification layers must not break existing UI contracts

| Rule | Implementation |
|------|----------------|
| Additive-only changes | New fields added, existing fields never removed |
| Version-aware rendering | UI checks data version before rendering |
| Graceful degradation | Missing fields render as `[NOT AVAILABLE]`, not crash |
| Schema evolution | All data schemas include version field |

---

## 2. Representing Unfinished Components

### 2.1 Implementation Status Taxonomy

| Status | Badge | Border | Can Export | Trust Level |
|--------|-------|--------|------------|-------------|
| `VERIFIED` | Green solid | Solid | Yes | High |
| `IMPLEMENTED` | Blue solid | Solid | Yes | High |
| `PENDING` | Yellow solid | Solid | Yes | Medium |
| `DEMO` | Orange | Dashed | Opt-in | None |
| `PLANNED` | Gray | Dotted | No | None |
| `NOT_AVAILABLE` | Gray | None | N/A | N/A |

### 2.2 Demo Component Rules

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ DEMO COMPONENT RENDERING RULES                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ 1. VISUAL DISTINCTION                                                        │
│    • Dashed border (2px)                                                     │
│    • Warning-color background (10% opacity)                                  │
│    • [DEMO] badge in top-left corner                                         │
│    • No solid/confident styling                                              │
│                                                                              │
│ 2. INTERACTION CONSTRAINTS                                                   │
│    • No "Verify" buttons on demo data                                        │
│    • No "Export as verified" option                                          │
│    • Tooltip on hover: "This is a placeholder for future implementation"    │
│    • Click expands to show upgrade path                                      │
│                                                                              │
│ 3. DATA CONSTRAINTS                                                          │
│    • Demo values prefixed: `demo_`, `placeholder_`, `mock_`                  │
│    • Demo values MUST NOT resemble real hashes                               │
│    • Demo timestamps use obvious placeholder: `0000-00-00T00:00:00Z`         │
│    • Demo IDs use repeating pattern: `xxxxxxxx`                              │
│                                                                              │
│ 4. CONTEXT REQUIREMENTS                                                      │
│    • Page-level banner if ANY demo components present                        │
│    • Section-level notice for each demo section                              │
│    • Export metadata includes `contains_demo_data: true`                     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Planned Component Rules

Components that are planned but not even mocked:

```
┌─────────────────────────────────────────────────────────────────┐
│ [PLANNED] Zero-Knowledge Execution Proof                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ This feature is planned for a future release.                  │
│                                                                 │
│ No data is available. No placeholder values are shown.         │
│                                                                 │
│ Expected availability: Q3 2026                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- Gray, muted styling
- No fake data whatsoever
- Only shows expected timeline (if known)
- Not included in exports

---

## 3. Phase-Invariant UI Rules

These rules apply identically to Pre-Execution, Live, and Post-Execution phases.

### 3.1 Header Structure

Every phase view MUST include:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [PHASE NAME]                                            [Read-Only] [Phase] │
├─────────────────────────────────────────────────────────────────────────────┤
│ ⚠️ [STATUS BANNER — shown if any DEMO/PENDING/WARNING conditions exist]     │
├─────────────────────────────────────────────────────────────────────────────┤
```

### 3.2 Data Display Patterns

| Data Type | Display Pattern | Example |
|-----------|-----------------|---------|
| Hash | Monospace, truncated with copy | `sha256:a1b2c3...` [📋] |
| Timestamp | ISO 8601, local timezone option | `2026-01-06T10:14:22Z` |
| ID | Monospace, full display | `exec_9f8e7d6c5b4a` |
| Status | Badge with color coding | `[VERIFIED]` `[DEMO]` |
| Duration | Human-readable with ms precision | `1.892s` or `234ms` |
| Count | Integer, no abbreviations | `7` not `~7` or `7+` |

### 3.3 Verification Status Display

Every verifiable claim MUST show:

```
[STATUS] Claim text
         └─ Source: [where this data came from]
         └─ Verified by: [verification method]
         └─ Hash: [if applicable]
```

Example:
```
[VERIFIED] Capsule output matches declared schema
           └─ Source: Execution record exec_9f8e7d6c
           └─ Verified by: Schema validator v2.1.0
           └─ Hash: sha256:9a0b1c2d3e4f...
```

### 3.4 Error and Warning Display

| Severity | Icon | Color | Behavior |
|----------|------|-------|----------|
| Blocking | 🔴 | Red | Prevents progression |
| High | 🟠 | Orange | Prominent warning |
| Medium | 🟡 | Yellow | Standard warning |
| Low | ⚪ | Gray | Informational |
| Pass | 🟢 | Green | Verification passed |

### 3.5 Interactive Elements

| Element | Allowed | Behavior |
|---------|---------|----------|
| Copy hash | ✅ | Copies to clipboard, shows confirmation |
| Expand section | ✅ | Reveals detail, no side effects |
| Export data | ✅ | Downloads file, no mutation |
| Verify chain | ✅ | Read-only verification, displays result |
| Edit anything | ❌ | Dashboard is read-only |
| Trigger execution | ❌ | No execution from analysis views |
| Delete records | ❌ | Audit trail is immutable |

---

## 4. Avoiding "Black Box AI Monitor"

### 4.1 The Problem

AI systems often become opaque when:
- Decisions are summarized without evidence
- Risk scores lack calculation transparency
- "AI detected X" without showing what triggered it
- Confidence levels without basis

### 4.2 Anti-Black-Box Rules

| Rule | Rationale |
|------|-----------|
| **No unexplained scores** | Every score shows its calculation |
| **No AI-generated summaries** | Summaries are templated, not generated |
| **No "detected" language** | Use "recorded", "observed", "computed" |
| **No confidence without basis** | "85% confident" requires showing why |
| **No hidden AI layers** | If AI processed data, show the AI step explicitly |

### 4.3 Transparency Patterns

**Pattern 1: Explainable Scores**

```
❌ Risk Score: 72/100 (High)

✅ Risk Score: 72/100 (High)
   ├─ Documentation alignment: 45/100 (-30 points)
   │   └─ 2 undeclared operations found
   │   └─ 4/6 steps documented (66.7%)
   ├─ Consent coverage: 60/100 (-20 points)
   │   └─ 1 policy failed, 2 pending
   ├─ Ingress/Egress: 30/100 (-40 points)
   │   └─ 2 undeclared external endpoints
   └─ AI involvement: 90/100 (-10 points)
       └─ 1 step without fallback
```

**Pattern 2: Evidence-Backed Claims**

```
❌ "Suspicious network activity detected"

✅ "Undeclared external endpoint accessed"
   Step: 3
   Operation: HTTP GET
   Endpoint: api.taxrates.io
   Declared in manifest: No
   Evidence: workflow.steps[2].action.http.url
```

**Pattern 3: AI Step Visibility**

```
❌ "Classification: Invoice"

✅ "Classification: Invoice"
   Computed by: llama3:8b (local)
   Input: 1,247 tokens (hash: sha256:abc...)
   Output: 34 tokens (hash: sha256:def...)
   Duration: 3,891ms
   Fallback: Default category "Uncategorized"
```

### 4.4 What the Dashboard Is NOT

| NOT This | But This |
|----------|----------|
| AI assistant | Structured data viewer |
| Decision maker | Decision recorder |
| Risk predictor | Risk calculator (deterministic) |
| Chat interface | Inspection interface |
| Autonomous monitor | Human-readable audit log |

---

## 5. Enterprise Trust Framework

### 5.1 Trust Signals

How enterprise users know they can trust what they see:

| Trust Signal | Implementation |
|--------------|----------------|
| **Hash verification** | Any hash can be independently verified |
| **Audit chain integrity** | One-click chain verification |
| **Policy snapshot** | Rules as they were at execution time |
| **No post-hoc modification** | Append-only data model |
| **Export completeness** | Export contains everything displayed |
| **External verifiability** | Standard formats, no proprietary encoding |

### 5.2 Skeptical User Mode

The UI should answer these questions without additional clicks:

| Question | How UI Answers |
|----------|----------------|
| "Is this data real or demo?" | Status badges on every section |
| "When was this recorded?" | Timestamps visible, not hidden |
| "Can I verify this independently?" | Hash + copy button everywhere |
| "What was the policy at execution?" | Policy snapshot section |
| "Has anything been modified?" | Chain integrity indicator |
| "Can I export for external audit?" | Export button, multiple formats |

### 5.3 Legal Defensibility Checklist

| Requirement | Dashboard Support |
|-------------|-------------------|
| Complete record | Full execution timeline with all steps |
| Timestamp accuracy | ISO 8601, recorded at event time |
| Immutability proof | Hash-chained audit trail |
| Policy documentation | Policy snapshot at execution time |
| Evidence preservation | All hashes preserved and exportable |
| Demo data separation | Clearly marked, excludable from export |

---

## 6. Adding New Verification Layers

### 6.1 Extension Points

The dashboard is designed to support new verification layers without breaking existing UI:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ VERIFICATION LAYER EXTENSION MODEL                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Current Layers:                                                             │
│ ├─ [VERIFIED] Audit Chain (hash-linked events)                             │
│ ├─ [VERIFIED] Content Hashes (SHA-256)                                     │
│ ├─ [VERIFIED] Policy Snapshots                                             │
│ └─ [DEMO] PoAE Attestations                                                │
│                                                                             │
│ Future Layers (additive):                                                   │
│ ├─ [PLANNED] PoAE (real implementation)                                    │
│ ├─ [PLANNED] Third-party attestation                                       │
│ ├─ [PLANNED] Blockchain anchoring                                          │
│ └─ [PLANNED] Zero-knowledge proofs                                         │
│                                                                             │
│ Each layer is:                                                              │
│ • Independent (doesn't break others)                                        │
│ • Additive (new data, not replacing)                                        │
│ • Optional (graceful when absent)                                           │
│ • Versioned (schema version included)                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 UI Contract for New Layers

When adding a new verification layer, the UI contract requires:

| Requirement | Description |
|-------------|-------------|
| **Status badge** | Layer shows `[DEMO]`, `[VERIFIED]`, or `[NOT_AVAILABLE]` |
| **Graceful absence** | If data missing, show `[NOT_AVAILABLE]`, don't crash |
| **Explanation section** | What this layer verifies, in plain language |
| **Verification action** | "Verify" button if layer is implemented |
| **Export handling** | Layer data included in exports when verified |

### 6.3 Schema Evolution Rules

```typescript
// Every verification layer follows this schema pattern:

interface VerificationLayer {
  // Always present
  layer_id: string;           // "audit_chain", "poae", "zk_proof"
  layer_version: string;      // Semantic version
  status: LayerStatus;        // "verified" | "demo" | "pending" | "not_available"
  
  // Present when implemented
  data?: LayerData;           // Layer-specific data
  verification_method?: string;
  verified_at?: string;       // ISO 8601
  
  // Present when demo
  demo_notice?: string;       // Explanation of placeholder status
  
  // Always present
  ui_hint: {
    badge: BadgeType;
    section_title: string;
    description: string;
  };
}
```

### 6.4 Upgrade Procedure

When upgrading a layer from `DEMO` to `VERIFIED`:

```
1. Backend starts populating real data
2. Schema version increments
3. UI detects new schema version
4. UI checks `status` field:
   - If "verified" → render with [VERIFIED] badge
   - If "demo" → render with [DEMO] badge (unchanged)
5. No UI code changes required for existing layouts
6. Export automatically includes verified data
```

---

## 7. Future-Proofing Guidelines

### 7.1 Data Model Principles

| Principle | Implementation |
|-----------|----------------|
| **Append-only** | Never delete, only add |
| **Version tagged** | Every record has schema version |
| **Self-describing** | Data includes its own type info |
| **Hash-referenced** | Related data linked by hash, not ID |
| **Timezone-aware** | All times in UTC, display in local |

### 7.2 UI Component Principles

| Principle | Implementation |
|-----------|----------------|
| **Status-driven** | Components render based on data status |
| **Graceful degradation** | Missing data shows placeholder, not error |
| **No hardcoded lists** | Categories derived from data, not hardcoded |
| **Extension-ready** | New verification types render generically |

### 7.3 What Won't Change

These contracts are stable and will not break:

| Contract | Guarantee |
|----------|-----------|
| Hash format | SHA-256, hex-encoded |
| Timestamp format | ISO 8601 with timezone |
| ID format | `{type}_{random}` pattern |
| Badge types | VERIFIED, DEMO, PENDING, NOT_AVAILABLE |
| Export formats | JSON, CSV |
| Status field | Always present in verification layers |

### 7.4 What May Evolve

These may change with proper versioning:

| Element | Evolution Path |
|---------|----------------|
| Verification layer types | New layers added |
| Export fields | New fields added, old preserved |
| Badge subtypes | New statuses possible |
| Calculation methods | Versioned, old methods preserved |

---

## 8. Summary: The Trust Equation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ENTERPRISE TRUST = DETERMINISM + TRANSPARENCY + AUDITABILITY + HONESTY      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ DETERMINISM                                                                 │
│   Same data → Same display → Same conclusions                               │
│   No randomness, no inference, no hidden state                              │
│                                                                             │
│ TRANSPARENCY                                                                │
│   Every value has a source                                                  │
│   Every score has a calculation                                             │
│   Every claim has evidence                                                  │
│                                                                             │
│ AUDITABILITY                                                                │
│   Everything exportable                                                     │
│   Everything verifiable                                                     │
│   Everything immutable                                                      │
│                                                                             │
│ HONESTY                                                                     │
│   Demo data clearly marked                                                  │
│   No false security claims                                                  │
│   Limitations explicitly stated                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

*End of Global UI System Rules.*





