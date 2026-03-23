# Refactor Handshake/Vault/Policy — Abschlussbericht

## 1. Kurzfassung

**Was wurde fachlich korrigiert?**
- AI-Policy: Zwei widersprüchliche Checkboxen (Cloud AI, Internal AI) wurden durch ein exklusives Enum `ai_processing_mode: 'none' | 'local_only' | 'cloud_allowed'` ersetzt.
- Vault-Hinweis: Wird nur noch bei Aktionen angezeigt, die tatsächlich Vault-Zugriff benötigen (Signieren, Accept, Vault-Profile anhängen).
- Context-Toggle: Umbenannt zu „Vault-Profile einbeziehen“, nur angezeigt wenn Vault-Profile relevant sind.
- Storage-Semantik: Private Schlüssel bleiben Vault-gebunden; Metadaten/Hashes/Verifikation ohne inneren Vault nutzbar.

**Warum ist das Modell jetzt konsistent?**
- Keine widersprüchlichen Zustände mehr (z.B. „internal only“ + „cloud allowed“ gleichzeitig).
- Vault-Anforderungen sind aktionsbezogen statt global.
- Legacy-Daten werden defensiv normalisiert (beide Booleans true → `local_only`).

---

## 2. Betroffene Dateien / Module

| Datei | Begründung |
|-------|------------|
| `packages/shared/src/handshake/policyUtils.ts` | Neues Modul: `AiProcessingMode`, `parsePolicyToMode`, `legacyToAiProcessingMode`, `serializePolicyForDb` |
| `packages/shared/src/handshake/types.ts` | `PolicySelection` auf `{ ai_processing_mode }` umgestellt |
| `packages/shared/src/handshake/policyUtils.test.ts` | Neue Tests für Legacy-Mapping und exklusive Semantik |
| `apps/electron-vite-project/electron/main/handshake/db.ts` | `parsePolicyToMode`, `serializePolicyForDb`; Storage-Semantik dokumentiert |
| `apps/electron-vite-project/electron/main/handshake/contextGovernance.ts` | `baselineFromHandshake`/`baselineFromPolicySelections` nutzen `parsePolicyToMode` |
| `apps/electron-vite-project/electron/main/handshake/initiatorPersist.ts` | Akzeptiert `ai_processing_mode` und Legacy-Format |
| `apps/electron-vite-project/electron/main/handshake/ipc.ts` | Typen für `ai_processing_mode`; Accept-Flow angepasst |
| `apps/electron-vite-project/electron/main.ts` | IPC `handshake:updatePolicies` akzeptiert `ai_processing_mode` |
| `apps/electron-vite-project/src/components/PolicyRadioGroup.tsx` | Neue exklusive Radio-Group für AI-Policy |
| `apps/electron-vite-project/src/components/RelationshipDetail.tsx` | PolicyRadioGroup statt PolicyCheckboxes; `parsePolicyToMode` für Legacy |
| `apps/electron-vite-project/src/components/HandshakeContextSection.tsx` | PolicyRadioGroup statt PolicyCheckboxes |
| `apps/electron-vite-project/src/components/VaultStatusIndicator.tsx` | Prop `requiresVault` für aktionsbezogene Anzeige |
| `apps/electron-vite-project/src/components/HandshakeInitiateModal.tsx` | VaultStatusIndicator mit `requiresVault` |
| `apps/electron-vite-project/src/components/AcceptHandshakeModal.tsx` | PolicyRadioGroup; Toggle „Vault-Profile einbeziehen“ |
| `apps/electron-vite-project/src/components/HandshakeManagementPanel.tsx` | Toggle umbenannt |
| `apps/electron-vite-project/vite.config.ts` | Alias `@shared` für Renderer-Build |
| `apps/extension-chromium/src/handshake/components/SendHandshakeDelivery.tsx` | PolicyRadioGroup; `parsePolicyToMode` |
| `apps/extension-chromium/src/handshake/buildInitiateContextOptions.ts` | `ai_processing_mode` in Payload |
| `apps/electron-vite-project/electron/main/handshake/__tests__/contextGovernance.test.ts` | Tests für `ai_processing_mode` und Legacy |
| `apps/electron-vite-project/src/components/handshakeViewTypes.ts` | `updateHandshakePolicies` Typ erweitert |
| `apps/electron-vite-project/src/components/PolicyCheckboxes.tsx` | **Entfernt** — ersetzt durch PolicyRadioGroup |

---

## 3. Implementierte Refactor-Änderungen

### Domain-Modell
- `ai_processing_mode: 'none' | 'local_only' | 'cloud_allowed'` als führende Semantik
- `legacyToAiProcessingMode()` für defensive Normalisierung alter Boolean-Kombinationen
- `parsePolicyToMode()` liest sowohl neues als auch Legacy-Format
- `serializePolicyForDb()` schreibt `ai_processing_mode` plus Legacy-Felder für Kompatibilität

### UI
- PolicyRadioGroup ersetzt PolicyCheckboxes überall (RelationshipDetail, HandshakeContextSection, SendHandshakeDelivery, AcceptHandshakeModal, HandshakeInitiateModal, InitiateHandshakeDialog, HandshakeRequestForm, HandshakeContextProfilePicker)
- Exklusive Auswahl: Kein gleichzeitiges „Internal only“ + „Cloud allowed“
- Per-item Override nutzt dieselbe exklusive Semantik

### Vault-Hinweis-Logik
- `VaultStatusIndicator` mit `requiresVault?: boolean` — bei `!requiresVault` kein Block bei gesperrtem Vault
- Hinweis nur bei Signieren, Accept, Vault-Profile anhängen, sensitive Context-Aktionen

### Toggle-Semantik
- „Contextual Handshakes“ → „Vault-Profile einbeziehen“
- `skipVaultContext = !canUseHsContextProfiles || !includeVaultProfiles`
- Toggle nur angezeigt, wenn Vault-Profile relevant und verfügbar

### Storage-/Persistenzsemantik
- In `db.ts` dokumentiert: Private Schlüssel Vault-bound; Signatur/Verifikation außerhalb; Metadaten/Hashes ohne inneren Vault sichtbar
- Handshake-Tabellen liegen in der Vault-SQLCipher-DB → `local_private_key` ist Vault-gebunden

### Legacy-Kompatibilität
- `parsePolicyToMode` akzeptiert `{ cloud_ai, internal_ai }` und `{ ai_processing_mode }`
- Ungültiger Zustand (beide true) → `local_only`
- Neue Schreibpfade verwenden `ai_processing_mode`; DB speichert beide Formate

---

## 4. Effektive Produktregeln nach dem Refactor

### AI-Policy-Regeln
- Exklusive Auswahl: genau einer von `none`, `local_only`, `cloud_allowed`
- Per-item Override verwendet dieselbe Semantik wie globale Policy
- Default: `local_only`

### Vault-Anforderungsregeln
- Ohne Vault: Liste, Metadaten, Verifikation, Policy ansehen
- Mit Vault: Signieren, Accept, Vault-Profile anhängen, sensitive Context-Zugriffe

### Context-Toggle-Regeln
- Steuert nur optionale Einbeziehung von Vault-Profilen
- Keine globale Vault-Pflicht
- Nur angezeigt, wenn Vault-Profile relevant

### Storage-Regeln
- Private Schlüssel: Vault-only
- Signatur/Verifikationsartefakte: außerhalb des inneren Vaults zulässig
- Metadaten/Hashes/Ledger: ohne inneren Vault sichtbar

---

## 5. Testabdeckung

| Test | Abdeckung |
|------|-----------|
| `policyUtils.test.ts` | Legacy-Mapping, `parsePolicyToMode`, `modeToUsageFlags`, `serializePolicyForDb` |
| `contextGovernance.test.ts` | `ai_processing_mode`, Legacy `cloud_ai`/`internal_ai`, Default bei fehlenden Selections |

---

## 6. Verbleibende Restlücken

- **electron-builder**: Der Build schlägt auf Windows mit „Zugriff verweigert“ (d3dcompiler_47.dll) fehl — Umgebungsproblem, nicht Code.
- **Extension-Build**: Die Extension wird über den Electron-Renderer gebündelt; eigenständiger Extension-Build sollte mit `@shared`-Alias funktionieren.
- **Vault-Hinweis-Tests**: Keine dedizierten UI-Tests für `requiresVault`; manuell verifizierbar.
