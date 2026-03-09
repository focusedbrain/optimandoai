# Handshake / Vault / Policy — Fachliche und technische Architekturanalyse

**Status:** Analyse (keine Implementierung)  
**Ziel:** Präzise fachliche und technische Analyse für ein logisch korrektes, sicheres und nutzerfreundliches Fachmodell.

---

## A. Kurzfazit

Die aktuelle Implementierung weist mehrere fachliche Widersprüche auf. **AI-Policy:** Die beiden Checkboxen „Cloud AI Processing“ und „Internal AI Only“ sind als unabhängige Booleans modelliert, obwohl sie semantisch eine exklusive Entscheidung abbilden (Cloud erlaubt vs. nur intern). Ein Nutzer kann beide aktivieren — das ist widersprüchlich. **Vault-Hinweise:** Der Hinweis „Vault unlock required“ wird global angezeigt, obwohl viele Handshake-Aktionen (Liste, Metadaten, Initiate mit Ledger) ohne entsperrten Vault funktionieren. Die Kopplung an den „Contextual Handshakes“-Toggle ist irreführend, weil der Toggle nur `skipVaultContext` steuert und nicht die tatsächliche Vault-Pflicht. **Context-Toggle:** Der Toggle bedeutet faktisch „Vault-Kontext einbeziehen“ (Vault-Profile), wird aber als „Contextual Handshakes“ bezeichnet — das impliziert fälschlich, es gäbe einen Handshake-Typ ohne Kontext. **Storage:** Handshake-Metadaten und Schlüssel liegen teils im Ledger (session-verschlüsselt), teils im Vault; die Signatur selbst ist im Payload, der private Schlüssel im Handshake-Record. Eine klare Trennung zwischen „browse ohne Vault“ und „signieren/sensible Daten mit Vault“ fehlt in der UI. **Zielrichtung:** AI-Policy als exklusives Enum modellieren; Storage-Modell klar trennen (Ledger = Metadaten/Hashes, Vault = Schlüssel/sensible Inhalte); Vault-Hinweise nur bei Aktionen anzeigen, die den Vault wirklich brauchen; den Context-Toggle umbenennen oder entfernen und stattdessen „Vault-Profile einbeziehen“ als explizite Option darstellen.

---

## B. AI-Policy fachlich korrekt modellieren

### Analyse: Warum die beiden Checkboxen problematisch sind

**Aktueller Zustand:**
- `PolicySelection = { cloud_ai?: boolean; internal_ai?: boolean }` (packages/shared, electron/main)
- UI: zwei unabhängige Checkboxen
- `baselineFromHandshake` mappt: `internal_ai` → `local_ai_allowed`, `cloud_ai` → `cloud_ai_allowed`
- Beide können gleichzeitig `true` sein

**Fachliche Inkonsistenz:**
- „Internal AI Only“ = Verarbeitung nur in internen Systemen → Cloud muss ausgeschlossen sein
- „Cloud AI Processing“ = Cloud-Verarbeitung erlaubt
- Beide gleichzeitig = „nur intern“ und „Cloud erlaubt“ → Widerspruch

**Technische Realität:**
- `ExternalProcessing = 'none' | 'local_only'` (types.ts)
- `maxExternalProcessing` in CapsulePolicy ist ein einzelner Wert
- Die Policy-Resolution nutzt bereits ein exklusives Modell; die UI bildet es falsch ab

### Empfehlung für Zielmodell

**Domain-Modell (exklusiv):**

```ts
type AiProcessingMode = 'none' | 'local_only' | 'cloud_allowed'

interface PolicySelection {
  ai_processing_mode: AiProcessingMode
}

// Semantik:
// - none: Keine AI-Verarbeitung
// - local_only: Nur interne/on-premise AI (Internal AI Only)
// - cloud_allowed: Cloud AI erlaubt (Cloud AI Processing)
```

**Alternativ als JSON für Persistenz:**

```json
{
  "ai_processing_mode": "local_only"
}
```

### Konkrete UI-Empfehlung

- **Radio-Gruppe** statt zwei Checkboxen:
  - „Keine AI-Verarbeitung“
  - „Nur interne AI (on-premise)“
  - „Cloud AI erlaubt“
- Oder **Dropdown** mit denselben drei Optionen
- Keine Möglichkeit, widersprüchliche Kombinationen auszuwählen

### Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `packages/shared/src/handshake/types.ts` | `PolicySelection` auf `ai_processing_mode` umstellen |
| `apps/electron-vite-project/electron/main/handshake/contextGovernance.ts` | `baselineFromHandshake` anpassen |
| `apps/electron-vite-project/electron/main/handshake/db.ts` | `parsePolicySelections` / Migration |
| `PolicyCheckboxes.tsx`, `SendHandshakeDelivery.tsx`, etc. | Checkboxen durch Radio/Dropdown ersetzen |

---

## C. Storage- und Vault-Modell

### Datenarten und Speicherort

| Datenart | Innerer Vault | Äußerer Vault / Ledger | Begründung |
|----------|--------------|-------------------------|------------|
| **Privater Schlüssel** (Ed25519) | **Ja** | Nein | Geheimnis; muss vor Zugriff geschützt sein |
| **Key Material / DEK** | **Ja** | Nein | Geheimnis |
| **Signatur (Blob)** | Nein | Ledger/Capsule | Integritätsnachweis; öffentlich verifizierbar |
| **Signierter Payload** | Nein | Capsule/Übertragung | Integritätsnachweis |
| **Hash des Payloads** | Nein | Ledger | Integritätsnachweis; nicht reversibel |
| **Handshake-Metadaten** (IDs, Status, Timestamps) | Nein | Ledger | UI-Metadaten; für Browse ohne Vault |
| **Context-Inhalte** (plaintext, Dokumente) | **Ja** (wenn sensibel) | Ledger-Hashes | Sensibler Inhalt; HS-Profile `extracted_text` verschlüsselt |
| **Governance-/Policy-Daten** | Nein | Ledger | Keine Geheimnisse |
| **HS Context Profile (extracted_text)** | **Ja** | Nein | Sensibler Inhalt; Envelope-Verschlüsselung |

### Begriffe

- **Geheimnis:** Muss vertraulich bleiben (Schlüssel, Credentials) → innerer Vault
- **Integritätsnachweis:** Prüfbar ohne Geheimnis (Signatur, Hash) → außerhalb möglich
- **UI-Metadaten:** Für Anzeige/Liste (Status, Partner, Zeit) → Ledger
- **Sensitiver Inhalt:** Kontextdaten, PII, Verträge → innerer Vault oder verschlüsselt

### Empfehlung: Signatur im inneren Vault?

**Nein.** Die Signatur selbst muss nicht im inneren Vault liegen. Nur der **private Schlüssel** muss dort sein. Die Signatur ist ein Integritätsnachweis und kann im Ledger oder in der Capsule gespeichert werden. Der private Schlüssel (`local_private_key`) hingegen gehört in den Vault, sobald dieser als sicherer Speicher genutzt wird. Aktuell liegt er im Handshake-Record in der Handshake-DB (Ledger oder Vault); wenn die Handshake-Tabellen im Vault liegen, ist das konsistent. Wenn sie im Ledger liegen, sollte der private Schlüssel separat im Vault gehalten werden.

---

## D. Aktionsmatrix

| Aktion | Innerer Vault nötig? | Äußerer Vault / Ledger | Im gesperrten Zustand möglich? | Begründung |
|--------|----------------------|-------------------------|-------------------------------|------------|
| Handshake-Liste anzeigen | Nein | Ja (Ledger) | **Ja** | Nur Metadaten |
| Handshake-Metadaten anzeigen | Nein | Ja | **Ja** | Keine Geheimnisse |
| Signaturstatus anzeigen | Nein | Ja | **Ja** | Hash/Signatur verifizierbar |
| Handshake verifizieren | Nein | Ja | **Ja** | Öffentlicher Schlüssel + Signatur |
| Handshake signieren | **Ja** | — | Nein | Privater Schlüssel nötig |
| Handshake erneut senden/exportieren | **Ja** (wenn Signatur) | — | Nein | Signatur = Schlüssel |
| Sensiblen Context anzeigen | **Ja** | — | Nein | Entschlüsselung nötig |
| Context anhängen (ad-hoc) | Nein | Ja | **Ja** | Plaintext, Hash reicht |
| Vault-Profil auswählen / anhängen | **Ja** | — | Nein | `extracted_text` aus Vault |
| Policy ansehen | Nein | Ja | **Ja** | Keine Geheimnisse |
| Policy ändern | Nein | Ja | **Ja** | Keine Geheimnisse |
| Details öffnen (ohne sensible Inhalte) | Nein | Ja | **Ja** | Metadaten |
| Accept durchführen | **Ja** | — | Nein | Signatur, ggf. Vault-Profile |
| Initiate durchführen (ohne Vault-Profile) | Nein | Ja (Ledger) | **Ja** | Ledger reicht |
| Initiate durchführen (mit Vault-Profilen) | **Ja** | — | Nein | Profile aus Vault |
| Context-Sync ausführen | **Ja** | — | Nein | Sensible Inhalte übertragen |

### Kategorien

- **Browse/Listing:** Kein Vault nötig
- **Verification:** Kein Vault nötig (öffentliche Prüfung)
- **Signing:** Vault nötig (privater Schlüssel)
- **Sensitive-Detail-Access:** Vault nötig (Entschlüsselung)

---

## E. Bewertung des Context-Toggles

### Mögliche Bedeutungen

| Bedeutung | Fachlich sinnvoll? | Aktuell implementiert? |
|-----------|--------------------|-------------------------|
| (a) Es wird überhaupt ein Handshake initiiert | Nein | Nein |
| (b) Es wird zusätzlicher Context angehängt | Teilweise | Teilweise (über skipVaultContext) |
| (c) Vault-gebundener vs. normaler Handshake | Irreführend | Nein — alle Handshakes sind signiert |
| (d) Nur Context-UI ein-/ausblenden | Nein | Nein |

### Was der Toggle faktisch steuert

- `skipVaultContext = !contextualHandshakes`
- Bei `db === null` und `!skipVaultContext`: Fehler „Vault must be unlocked for contextual handshakes“
- Bei `skipVaultContext === true`: Kein Fehler bei `db === null` (aber Persistenz schlägt trotzdem fehl)
- Der Toggle beeinflusst **nicht**, ob Vault-Profile (`profile_ids`) gesendet werden — die werden unabhängig davon aufgelöst

### Empfehlung

**Umbenennen und semantisch schärfen:**

- **Neuer Name:** „Vault-Profile einbeziehen“ / „Include Vault Profiles“
- **Bedeutung:** Wenn aktiviert, werden HS Context Profile aus dem Vault in den Handshake einbezogen. Dafür muss der Vault entsperrt sein.
- **UI:** Checkbox/Toggle nur sichtbar, wenn Vault-Profile überhaupt verfügbar sind (Publisher+). Wenn keine Profile existieren, Toggle ausblenden.
- **Alternative:** Toggle entfernen und stattdessen: Wenn der Nutzer Vault-Profile auswählt, automatisch Vault-Entsperrung verlangen. Kein globaler Toggle.

**Falls beibehalten:** Exakter Name „Vault-Profile einbeziehen“, Beschreibung: „Fügt gespeicherte Geschäftsdaten aus Ihrem Vault dem Handshake hinzu. Erfordert entsperrten Vault.“

---

## F. Empfohlenes Ziel-UX

### Dialog-Struktur

1. **Immer sichtbar (global):**
   - Empfänger, Betreff, Liefermethode
   - AI-Policy (als Radio/Dropdown, siehe B)

2. **Abhängig von Vault-Status:**
   - „Vault-Profile einbeziehen“ nur anzeigen, wenn Vault existiert und Profile verfügbar sind
   - Hinweis „Vault entsperren erforderlich“ nur bei Aktionen, die den Vault brauchen (z.B. vor Accept, vor Initiate mit Profilen)

3. **Optionaler Context:**
   - Ad-hoc-Context (Plain Text / JSON) immer sichtbar
   - Per-Item-Policy (Use default / Override) pro Context-Block
   - Vault-Profile-Picker nur wenn „Vault-Profile einbeziehen“ aktiv

### Hinweise

- **Global:** Kein permanenter „Vault unlock required“-Banner, wenn der Nutzer nur browst oder einen Handshake ohne Vault-Profile initiiert
- **Lokal:** „Vault entsperren erforderlich“ nur in Bereichen, die Vault-Zugriff brauchen (z.B. über dem Vault-Profile-Picker, vor Accept-Button)
- **Fehler:** Bei fehlgeschlagener Aktion wegen gesperrtem Vault: klare Meldung mit Handlungsanweisung

### AI-Policy-Platzierung

- Im Handshake-Dialog als eigenes Feld, oberhalb des Context-Bereichs
- Als Default für neu angehängte Context-Items („inherit“)
- Per-Item-Override nur bei „Override“-Modus

### Vault-Hinweis

- Nicht global im gesamten Dialog
- Nur wenn: (a) Nutzer Vault-Profile auswählt, oder (b) Accept ausführt, oder (c) eine Aktion fehlschlägt mit VAULT_LOCKED
- Text: „Für diese Aktion muss Ihr Vault entsperrt sein.“

---

## G. Konkretes Zielmodell

```ts
// Handshake Visibility Data (ohne Vault)
interface HandshakeVisibility {
  handshake_id: string
  relationship_id: string
  state: HandshakeState
  initiator_email: string
  acceptor_email: string | null
  created_at: string
  capsule_hash: string
  // Keine Schlüssel, keine sensiblen Inhalte
}

// Sensitive Detail Data (Vault erforderlich)
interface HandshakeSensitiveDetail {
  local_private_key: string
  context_blocks_content: Record<string, string>  // entschlüsselt
  counterparty_p2p_token: string | null
}

// Policy Mode (exklusiv)
type AiProcessingMode = 'none' | 'local_only' | 'cloud_allowed'

interface PolicySelection {
  ai_processing_mode: AiProcessingMode
}

// Vault Requirement Flags (abgeleitet)
type VaultRequirement =
  | 'never'      // Browse, Verify
  | 'for_signing' // Sign, Export
  | 'for_context' // Vault-Profile, sensible Inhalte

// Context Attachments
interface ContextAttachment {
  block_id: string
  block_hash: string
  policy_mode: 'inherit' | 'override'
  policy?: PolicySelection  // nur bei override
}

// Effective Processing Mode (resolved)
// = Handshake-Baseline + Item-Override
```

---

## H. Entscheidungs-Empfehlung

### 1. Zwingend ändern

- **AI-Policy:** Von zwei Booleans auf exklusives Enum (`ai_processing_mode`) umstellen
- **UI:** Checkboxen durch Radio/Dropdown ersetzen, widersprüchliche Kombinationen verhindern
- **Vault-Hinweis:** Nicht mehr global anzeigen; nur bei Aktionen, die den Vault wirklich benötigen

### 2. Wahrscheinlich ändern

- **Context-Toggle:** Umbenennen in „Vault-Profile einbeziehen“ und nur bei vorhandenen Profilen anzeigen
- **Storage:** Private Schlüssel explizit im Vault halten, wenn Handshake-Tabellen im Ledger liegen
- **Fehlerbehandlung:** Bei `db === null` und `skipVaultContext === true` nicht still „Erfolg“ zurückgeben, sondern explizit fehlschlagen

### 3. Kann bleiben

- Ledger für Metadaten/Hashes
- Trennung von `getHandshakeDb()` (Ledger first, Vault fallback)
- Per-Item-Policy mit `policy_mode: 'inherit' | 'override'`
- `external_processing: 'none' | 'local_only'` im Capsule-Format

### 4. Zu vermeidende Begriffe

- „Contextual Handshakes“ als Gegensatz zu „Basic“ — alle Handshakes sind kontextfähig
- „Vault unlock required“ als Dauerhinweis — nur bei konkreter Aktion
- „Cloud AI“ und „Internal AI“ als unabhängige Optionen — als exklusive Modi modellieren

---

## Anhang: Betroffene Dateien und Modul-Kopplungen

| Modul | Aktuelle Kopplung | Empfohlene Korrektur |
|-------|-------------------|----------------------|
| `VaultStatusIndicator.tsx` | Zeigt immer „Vault unlock required“ wenn locked | Nur rendern, wenn Aktion Vault braucht |
| `HandshakeInitiateModal.tsx` | Zeigt VaultStatusIndicator immer | Conditional: nur bei Profil-Auswahl oder vor Submit |
| `SendHandshakeDelivery.tsx` | contextualHandshakes → skipVaultContext | Umbenennen, Semantik schärfen |
| `contextGovernance.ts` | baselineFromHandshake nutzt cloud_ai, internal_ai | Auf ai_processing_mode umstellen |
| `policyResolution.ts` | maxExternalProcessing bereits exklusiv | Beibehalten; UI anpassen |
| `initiatorPersist.ts` | policy_selections als { cloud_ai, internal_ai } | Migration auf ai_processing_mode |
| `db.ts` | policy_selections JSON | Migration + parsePolicySelections anpassen |

---

*Analyse abgeschlossen. Keine Implementierung durchgeführt.*
