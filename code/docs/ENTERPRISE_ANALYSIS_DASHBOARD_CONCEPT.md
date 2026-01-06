# Enterprise Analysis Dashboard — Concept Document

**Status:** Analysis Only  
**Date:** 2026-01-06  
**Branch:** `analysis/enterprise-dashboard-concept`

---

## 1. Existing UI Surfaces

### 1.1 Electron Main Window (`App.tsx`)

| Surface | Current State | Dashboard Potential |
|---------|---------------|---------------------|
| **Topbar** | Brand, capture icons, Plans, Settings | Host dashboard navigation tabs |
| **Sidebar** (240px) | Placeholder "Navigation" section | Primary dashboard phase selector |
| **Main Content Area** | Placeholder with capture controls | Dashboard panel container |
| **Modal System** | Settings, Plans, Trigger dialogs | Detail overlays, drill-downs |

### 1.2 Available Backend Services

| Service Domain | Endpoint Prefix | Data Type |
|----------------|-----------------|-----------|
| Health | `/api/health` | System status, service readiness |
| Orchestrator | `/api/orchestrator/*` | Execution state, configuration |
| Vault | `/api/vault/*` | Secure storage status, item counts |
| LLM | `/api/llm/*` | Model status, hardware, performance metrics |
| OCR | `/api/ocr/*` | OCR engine status, routing |
| Email | `/api/email/*` | Account connections, message metadata |
| Parser | `/api/parser/pdf/*` | Document processing results |
| Crypto | `/api/crypto/pq/*` | Post-quantum key status |

### 1.3 Extension Data Stores (Potential Sync Targets)

| Store | Purpose | Audit Relevance |
|-------|---------|-----------------|
| `useAuditStore` | Hash-chained, append-only audit trail | **Primary audit source** |
| `usePackageStore` | Package registry, message state | Execution history |
| `useOutboxStore` | Delivery attempts, status transitions | Delivery verification |
| `useIngressStore` | Incoming message events | Input analysis |
| `useReconstructionStore` | Semantic extraction state | Content verification |
| `WorkflowRunner` | Step execution, errors, context | Execution trace |

---

## 2. Proposed Dashboard Structure

### 2.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ TOPBAR: OpenGiraffe │ [Pre-Exec] [Live] [Post-Exec] │ Settings │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│   SIDEBAR    │              MAIN PANEL                          │
│              │                                                  │
│  Phase       │   Phase-specific dashboard view                  │
│  Filters     │                                                  │
│              │   - Summary cards                                │
│  Entity      │   - Data tables                                  │
│  Navigator   │   - Verification status                          │
│              │                                                  │
│  Status      │   - Timeline / log views                         │
│  Indicators  │                                                  │
│              │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### 2.2 Navigation Model

| Tab | URL Anchor | Primary View |
|-----|------------|--------------|
| Pre-Execution | `#/analysis/pre` | Input validation, policy compliance |
| Live Execution | `#/analysis/live` | Active execution monitoring |
| Post-Execution | `#/analysis/post` | Verification, audit chain integrity |

### 2.3 Design Principles

- **No prose explanations in UI** — Data tables, status badges, timestamps
- **Deterministic display** — Same input = same output, always
- **Hash verification visible** — Show hash values, chain links
- **Zero-trust presentation** — Assume viewer is auditor

---

## 3. Analysis Phase Definitions

---

### 3.1 Pre-Execution Analysis

#### Purpose

Validate inputs before any execution occurs.  
Ensure policy compliance, schema validity, and resource availability.

#### Data Sources (Conceptual)

| Source | Data |
|--------|------|
| Incoming request payload | Raw input structure |
| Schema validation layer | Validation pass/fail, error details |
| Policy engine | Applicable policies, permission checks |
| Resource availability | LLM status, vault lock state, service health |
| Historical context | Prior executions for same entity/pattern |

#### User Expectations

| User Type | Expectation |
|-----------|-------------|
| **SOC Analyst** | Identify anomalous input patterns before execution |
| **DevSecOps** | Verify policy enforcement gates are active |
| **Auditor** | Confirm pre-execution state was captured and hashed |

#### Display Elements

- Input payload summary (redacted sensitive fields)
- Schema validation result (pass/fail with path references)
- Policy evaluation table (policy ID, decision, reason)
- Service readiness checklist
- Pre-execution hash (input fingerprint)

---

### 3.2 Live Execution Analysis

#### Purpose

Monitor active executions in real-time.  
Track step progression, resource consumption, and intermediate states.

#### Data Sources (Conceptual)

| Source | Data |
|--------|------|
| Workflow execution context | Current step, elapsed time, collected data |
| Step results | Individual step outcomes, errors |
| LLM interactions | Model invoked, tokens used, latency |
| External calls | HTTP requests made, responses received |
| Resource metrics | Memory, CPU, active connections |

#### User Expectations

| User Type | Expectation |
|-----------|-------------|
| **SOC Analyst** | Detect stuck or anomalous executions immediately |
| **DevSecOps** | Monitor resource consumption, identify bottlenecks |
| **Auditor** | Verify execution path matches declared workflow |

#### Display Elements

- Active execution list (execution ID, workflow ID, start time, current step)
- Step timeline (completed steps with duration, pending steps)
- Error indicators (step ID, error type, retry count)
- Live metrics (tokens consumed, calls made, time elapsed)
- Execution state hash (in-progress checksum)

---

### 3.3 Post-Execution Verification

#### Purpose

Verify completed executions for integrity and correctness.  
Provide audit trail for compliance review.

#### Data Sources (Conceptual)

| Source | Data |
|--------|------|
| Audit chain | Hash-chained event log (append-only) |
| Execution results | Final output, success/failure |
| Delivery records | Outbox status, delivery attempts |
| Reconstruction state | Semantic extraction, raster references |
| Verification hashes | Content hashes, chain integrity |

#### User Expectations

| User Type | Expectation |
|-----------|-------------|
| **SOC Analyst** | Confirm no tampering occurred post-execution |
| **DevSecOps** | Review failure modes, identify systemic issues |
| **Auditor** | Export audit trail, verify hash chain integrity |

#### Display Elements

- Completed execution list (execution ID, outcome, duration, hash)
- Audit chain viewer (event sequence with hash links)
- Chain integrity status (verified/broken, break point if applicable)
- Delivery verification (attempts, final status, recipient confirmation)
- Export controls (JSON, CSV — for external audit tools)

---

## 4. Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        INPUT                                    │
│  (Request payload, user action, scheduled trigger)              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PRE-EXECUTION ANALYSIS                        │
│  - Schema validation                                            │
│  - Policy evaluation                                            │
│  - Resource check                                               │
│  - Input hash capture                                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (proceed / reject)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   LIVE EXECUTION ANALYSIS                       │
│  - Step-by-step monitoring                                      │
│  - Resource consumption                                         │
│  - Error detection                                              │
│  - Intermediate state hashing                                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (complete / fail)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   POST-EXECUTION VERIFICATION                   │
│  - Audit chain append                                           │
│  - Delivery confirmation                                        │
│  - Chain integrity verification                                 │
│  - Export for external audit                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Constraints

| Constraint | Rationale |
|------------|-----------|
| No marketing language | SOC/audit users expect clinical terminology |
| No agent metaphors | "Agent" implies autonomy; use "step", "handler", "executor" |
| No speculative features | Only reference implemented data sources |
| Hash visibility | All cryptographic hashes must be displayable and copyable |
| Append-only audit | Audit store must never allow deletion or modification |
| Offline capability | Dashboard must function when cloud services unavailable |

---

## 6. Recommended Next Steps (Future Implementation)

1. **Create dashboard route structure** in Electron renderer
2. **Implement sidebar phase selector** with state management
3. **Build data fetching layer** for each phase's data sources
4. **Design table/list components** for SOC-style data presentation
5. **Add hash verification UI** with copy-to-clipboard
6. **Implement export functionality** for audit compliance

---

## 7. Non-Goals (Out of Scope)

- Automated remediation actions
- Predictive analytics or ML-based insights
- Multi-tenant dashboard views
- Real-time collaboration features
- Integration with external SIEM systems (future consideration)

---

*End of concept document.*


