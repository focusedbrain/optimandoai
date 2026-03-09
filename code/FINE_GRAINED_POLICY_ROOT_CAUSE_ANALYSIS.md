# Root-Cause-Analyse: Feingranulare Context-Policy

## A. Kurzfazit

Die Implementierung hat ein **feingranulares Datenmodell** (governance_json pro Block, ContextItemEditor, per-item Badges) und **Backend-Enforcement** (filterBlocksForCloudAI etc.), aber die **UI und der Datenfluss beim Hinzufügen von Context** sind falsch ausgerichtet:

1. **Policy wird nie an die RPC übergeben**: `handshake.initiate` und `handshake.accept` erhalten keine `policy_selections`. Die PolicyCheckboxes speichern nur per `updateHandshakePolicies` nachträglich in der Handshake-Row – zu spät für die Block-Governance.

2. **Timing-Bug**: `context_store`-Einträge werden mit `governance_json` erzeugt, während `baselineFromHandshake(record)` verwendet wird. Zu diesem Zeitpunkt hat `record.policy_selections` entweder noch keinen Wert (Initiate) oder den des Initiators (Accept). Die Nutzerauswahl aus den PolicyCheckboxes wird nie auf die Blöcke angewendet.

3. **Keine per-Item-Policy beim Anhängen**: Beim Auswählen von Vault Profiles oder Ad-hoc-Context gibt es keine UI, um pro Item eine Policy zu setzen. Es existieren nur globale Checkboxen. Per-Item-Bearbeitung ist erst nach dem Handshake in RelationshipDetail möglich – zu spät für die initiale Zuordnung.

4. **Fachlich falsche Interpretation**: „Default Policy for newly attached context“ wurde als einzige Steuerung umgesetzt. Die Anforderung „Policy pro angehängtem Context-Element“ wurde auf „ein globaler Default, der später pro Item überschrieben werden kann“ reduziert – ohne dass der Default überhaupt korrekt ankommt und ohne dass beim Anhängen eine per-Item-Steuerung sichtbar ist.

---

## B. Sichtbare Beweise aus dem UI-Code

### Zeigt nur globale Policy

| Stelle | Beweis |
|-------|--------|
| `PolicyCheckboxes.tsx` Zeile 51 | Überschrift: „Default policy for newly attached context“ – explizit nur Default |
| `PolicyCheckboxes.tsx` Zeile 56 | Nur zwei Checkboxen: Cloud AI, Internal AI – keine pro-Item-Logik |
| `HandshakeInitiateModal.tsx` | PolicyCheckboxes vor SendHandshakeDelivery, `policies` nur für `updateHandshakePolicies` nach Success – nie an RPC übergeben |
| `AcceptHandshakeModal.tsx` Zeile 202 | PolicyCheckboxes oberhalb des Context-Graphs – keine Verknüpfung mit `selectedProfileIds` oder `contextGraphText` |
| `AcceptHandshakeModal.tsx` Zeile 119–126 | `buildContextBlocks()` erzeugt Blöcke ohne `policy`/`governance` – nur `block_id`, `block_hash`, `type`, `content`, `scope_id` |
| `HandshakeContextProfilePicker.tsx` | `selectedIds`, `onChange(ids)` – nur IDs, kein Policy-Feld pro Profil |

### Fehlende UI für per-Context-Policy

| Erwartet | Tatsächlich |
|----------|-------------|
| Pro Vault-Profil: Policy-Toggles oder Badge | Keine – nur Multi-Select |
| Pro Ad-hoc-Block: Policy vor dem Hinzufügen | Keine – nur Textarea/Format |
| Sichtbare effektive Policy je Item beim Anhängen | Erst in RelationshipDetail nach Ingestion |
| „Override“-Modus pro Item (inherit vs. override) | Nur in ContextItemEditor nachträglich, nicht beim Anhängen |

---

## C. Datenmodell: Ist vs. Soll

### Vermutetes fehlerhaftes Ist-Modell (Frontend beim Initiate/Accept)

```json
{
  "policies": {
    "cloud_ai": false,
    "internal_ai": false
  },
  "contextBlocks": [
    { "block_id": "blk_1", "block_hash": "...", "type": "plaintext", "content": "...", "scope_id": "acceptor" }
  ],
  "selectedProfileIds": ["profile-1", "profile-2"]
}
```

- `policies` ist nur Handshake-State, wird nicht an RPC übergeben.
- `contextBlocks` haben kein `policy`/`governance`.
- `selectedProfileIds` haben keine Policy-Metadaten.

### Backend beim Erzeugen der Blöcke

```javascript
// ipc.ts / initiatorPersist.ts
const baseline = baselineFromHandshake(record)  // record.policy_selections = undefined (Initiate) oder Initiator-Wert (Accept)
const buildGov = (b) => createDefaultGovernance({
  usage_policy: { ...baseline },  // Nutzerauswahl fehlt hier
  ...
})
insertContextStoreEntry(db, { ..., governance_json: JSON.stringify(buildGov(block)) })
```

- Governance wird aus `record` abgeleitet, nicht aus den Formulardaten.
- `updateHandshakePolicies` wird erst danach aufgerufen – zu spät für die Block-Erstellung.

### Fachlich korrektes Zielmodell

```json
{
  "defaultPolicy": {
    "cloud_ai": false,
    "internal_ai": true
  },
  "attachedContexts": [
    {
      "id": "ctx_1",
      "type": "vault_profile",
      "profile_id": "profile-1",
      "policy": {
        "mode": "override",
        "cloud_ai": false,
        "internal_ai": true,
        "searchable": false,
        "export_allowed": false
      }
    },
    {
      "id": "ctx_2",
      "type": "adhoc_context",
      "content": "...",
      "policy": {
        "mode": "inherit"
      }
    }
  ]
}
```

- `defaultPolicy` als Basis für neue Items.
- Jedes `attachedContext` hat `policy` mit `mode: "inherit" | "override"` und ggf. expliziten Werten.
- RPC muss `defaultPolicy` und `attachedContexts[].policy` erhalten und in `governance_json` überführen.

---

## D. Wahrscheinliche Fehlerkette

1. **Anforderung unscharf**: „Default Policy“ und „Policy pro Context“ wurden vermischt; Fokus lag auf Default-Checkboxen.
2. **API-Design**: `handshake.initiate` und `handshake.accept` wurden ohne Policy-Parameter definiert; `policy_selections` nur als Handshake-Attribut.
3. **Frontend-Flow**: PolicyCheckboxes speichern per `updateHandshakePolicies` nach Success – Governance der Blöcke ist zu diesem Zeitpunkt bereits gesetzt.
4. **Backend-Logik**: `baselineFromHandshake(record)` nutzt `record.policy_selections`, das beim Block-Insert noch nicht aktualisiert ist.
5. **Keine per-Item-UI beim Anhängen**: Vault Picker und Ad-hoc-Form haben keine Policy-Felder; per-Item-Editor existiert nur in RelationshipDetail nach Ingestion.
6. **Ergebnis**: Nur globaler Default sichtbar, der zudem nicht zuverlässig auf die Blöcke durchschlägt.

---

## E. Konkrete Prüfstellen im Code

### Komponenten

| Suche | Datei | Befund |
|-------|-------|--------|
| `PolicyCheckboxes` | `PolicyCheckboxes.tsx` | Nur `cloud_ai`, `internal_ai`; kein `attachedContexts[].policy` |
| `HandshakeContextProfilePicker` | `HandshakeContextProfilePicker.tsx` | `selectedIds`, `onChange(ids)` – keine Policy |
| `AcceptHandshakeModal` / `buildContextBlocks` | `AcceptHandshakeModal.tsx` | Blöcke ohne `policy` |
| `SendHandshakeDelivery` | `SendHandshakeDelivery.tsx` | Übergibt keine Policy an `initiateHandshake` |

### State / Props

| Suche | Befund |
|-------|--------|
| `policies` in Initiate/Accept | Nur `PolicySelection` (cloud_ai, internal_ai); nicht pro Block |
| `selectedProfileIds` | Keine Policy-Metadaten |
| `context_blocks` in RPC-Params | Kein `policy`/`governance` pro Block |

### API / RPC

| Suche | Befund |
|-------|--------|
| `handshake.initiate` Params | Kein `policy_selections` oder `default_policy` |
| `handshake.accept` Params | Kein `policy_selections`; `context_blocks` ohne `policy` |
| `updateHandshakePolicies` | Wird nach RPC aufgerufen; Blöcke sind bereits erstellt |

### Backend / Persistenz

| Suche | Befund |
|-------|--------|
| `baselineFromHandshake` | Nutzt `record.policy_selections` – zum Insert-Zeitpunkt oft leer/falsch |
| `buildGovernanceForInitiatorBlock` / `buildGovernanceForReceiverBlock` | Verwendet nur `baseline`; keine pro-Block-Override aus Request |
| `insertContextStoreEntry` | `governance_json` aus `buildGov(block)` – keine Request-Policy |

### Schema / DB

| Suche | Befund |
|-------|--------|
| `context_blocks.governance_json` | Vorhanden; wird aus Backend-Logik gesetzt, nicht aus Request |
| `context_store.governance_json` | Analog |
| `handshakes.policy_selections` | Vorhanden; wird nach Block-Erstellung aktualisiert |

---

## F. Root-Cause-Bewertung (Gewichtung)

| Ursache | Gewichtung | Begründung |
|---------|------------|------------|
| **Anforderungs-Missverständnis** | 35% | „Default“ wurde als Hauptlösung verstanden; „Policy pro Context“ nur als nachträglicher Override |
| **Datenfluss / API-Design** | 30% | Policy wird nicht an RPC übergeben; `updateHandshakePolicies` kommt zu spät |
| **UI nur teilweise umgesetzt** | 25% | Per-Item-Editor nur in RelationshipDetail; keine Policy-UI beim Anhängen |
| **Timing-Bug (Policy nach Block-Insert)** | 10% | Selbst der globale Default kommt nicht zuverlässig an |

---

## G. Minimaler Fix-Plan

### 1. API erweitern

- `handshake.initiate`: `policy_selections` oder `default_policy` als Parameter.
- `handshake.accept`: `policy_selections` + optional `context_blocks[].policy` (Override pro Block).

### 2. Backend anpassen

- Beim Erzeugen der Blöcke: `policy_selections` aus dem Request verwenden, nicht aus `record`.
- Bei `context_blocks[].policy`: Override in `governance_json` übernehmen statt nur Baseline.

### 3. Frontend anpassen

- PolicyCheckboxes-Werte vor dem RPC-Aufruf an `initiate`/`accept` übergeben.
- Optional: Pro Vault-Profil und pro Ad-hoc-Block Policy-Toggles/Badges beim Anhängen.

### 4. Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `HandshakeInitiateModal.tsx` | `policies` an `initiateHandshake` übergeben (oder RPC vor Initiate mit Policies aufrufen) |
| `AcceptHandshakeModal.tsx` | `policies` an `acceptHandshake` übergeben; ggf. `context_blocks[].policy` |
| `handshake/ipc.ts` | `initiate`/`accept`-Handler: `policy_selections` aus Params lesen und vor Block-Insert in `record` setzen oder direkt an `buildGovernance*` übergeben |
| `initiatorPersist.ts` | `policy_selections` aus Aufrufer übernehmen statt aus `record` |
| `HandshakeContextProfilePicker` (optional) | Pro Profil Policy-Badge/Toggle |
| `AcceptHandshakeModal` Ad-hoc-Bereich (optional) | Pro Block Policy vor dem Hinzufügen |

---

## H. Repo-Verifikation: Betroffene Module

| Modul | Konkrete Fehlentscheidung |
|-------|---------------------------|
| `PolicyCheckboxes.tsx` | Nur globaler Default; kein Bezug zu `attachedContexts` |
| `HandshakeInitiateModal.tsx` | `updateHandshakePolicies` nach Success; keine Weitergabe an RPC |
| `AcceptHandshakeModal.tsx` | Gleicher Fehler; `buildContextBlocks()` ohne Policy |
| `handshake/ipc.ts` (initiate/accept) | Keine Policy-Parameter; Governance aus `record` statt aus Request |
| `initiatorPersist.ts` | `baselineFromHandshake(record)` mit leerem `policy_selections` |
| `HandshakeContextProfilePicker.tsx` | Nur `selectedIds`; keine Policy-Metadaten |

**Kleinste notwendige Architekturänderung:** Policy (Default + pro-Item-Overrides) als Teil des Request-Payloads an Initiate/Accept übergeben und beim Erzeugen der `context_store`-Einträge direkt in `governance_json` abbilden, statt sie aus dem Handshake-Record abzuleiten.
