# NLP Pipeline Documentation

## Overview

The orchestrator uses an NLP classification layer to structure user input before routing it to agents. This layer extracts triggers, entities, and prepares input for multi-agent dispatch.

## Architecture

```
User Input (WR Chat / OCR)
       │
       ▼
┌──────────────────┐
│   Tesseract OCR  │  ← For images/screenshots
│   (if needed)    │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│  wink-nlp NLP    │  ← Tokenize, extract entities
│  Classifier      │  ← Detect #triggers
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ ClassifiedInput  │  ← Structured JSON
│      JSON        │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│Input Coordinator │  ← Routes to agents based on
│                  │     triggers, entities, rules
└──────────────────┘
       │
       ▼
┌──────────────────┐
│Agent Allocations │  ← Multiple agents can process
│  with Reasoning  │     same input with different
│  & LLM config    │     reasoning/LLM/output slots
└──────────────────┘
```

## ClassifiedInput JSON Structure

```typescript
interface ClassifiedInput {
  // Original input
  rawText: string;
  normalizedText: string;  // lowercased, trimmed
  
  // Extracted data
  triggers: string[];      // tokens starting with # (e.g., ["#termin17", "#buchhaltung"])
  entities: Array<{
    type: 'date' | 'time' | 'person' | 'org' | 'number' | 'email' | 'url' | 'hashtag' | 'mention' | 'other';
    value: string;
    start: number;         // char index
    end: number;           // char index
  }>;
  intents?: string[];      // optional: schedule, invoice, search, etc.
  
  // Metadata
  source: 'inline_chat' | 'ocr' | 'other';
  errors: string[];        // non-fatal parsing issues
  timestampIso: string;
  ocrConfidence?: number;
  sourceUrl?: string;
  sessionKey?: string;
  
  // Agent allocations (populated by InputCoordinator)
  agentAllocations?: AgentAllocation[];
}

interface AgentAllocation {
  agentId: string;
  agentName: string;
  agentIcon: string;
  agentNumber?: number;
  
  // Agent reasoning config (goals, role, rules)
  reasoning: {
    goals: string;
    role: string;
    rules: string;
  };
  
  // LLM configuration
  llmProvider: string;     // e.g., 'ollama'
  llmModel: string;        // e.g., 'llama3.2'
  
  // Output destination
  outputSlot: {
    boxId?: string;
    boxNumber?: number;
    destination: string;   // e.g., "Agent Box 01"
  };
  
  // Match info
  matchReason: 'trigger' | 'expected_context' | 'apply_for' | 'default';
  matchDetails: string;
  triggerName?: string;
  triggerType?: 'active' | 'passive';
}
```

## Trigger Detection

**Rule:** Any token starting with `#` is classified as a trigger.

Examples:
- `#termin17` → trigger
- `#buchhaltung` → trigger
- `#invoice-2024` → trigger (hyphens allowed)
- `@mention` → mention entity (backward compatibility, not a trigger)

Triggers are stored WITH the `#` prefix in the `triggers` array.

## Entity Extraction

The classifier extracts these entity types:

| Type | Pattern Examples |
|------|-----------------|
| `date` | `17.8.`, `17.8.2024`, `August 17` |
| `time` | `14:30`, `2:30 PM` |
| `email` | `user@example.com` |
| `url` | `https://example.com/page` |
| `number` | `€100.50`, `50%`, `1,234` |
| `hashtag` | `#trigger` |
| `mention` | `@username` |

## NLP Engine

### wink-nlp

The classifier uses [wink-nlp](https://github.com/winkjs/wink-nlp) with the `wink-eng-lite-web-model` for:
- Tokenization
- Named Entity Recognition (NER)
- Fast, client-side processing

### Lazy Initialization

The NLP model is loaded lazily on first use to minimize startup time:

```typescript
import { nlpClassifier } from './nlp'

// Model loads on first classify call
const result = await nlpClassifier.classify(text, 'inline_chat')
```

### Updating the Model

To update the wink-nlp model:

```bash
cd apps/extension-chromium
npm update wink-nlp wink-eng-lite-web-model
```

## Fallback Behavior

If wink-nlp fails to load or crashes, the classifier falls back to regex-based parsing:

- Triggers: `/#[\w-]+/g`
- Dates: Common patterns like `DD.MM.YYYY`
- Emails: Standard email regex
- URLs: `https?://...`

The `errors` array in ClassifiedInput will contain the failure reason.

## Integration Points

### Sidepanel Message Handler

In `sidepanel.tsx`, NLP classification happens after OCR and before routing:

```typescript
// Step 3: OCR (if images present)
const { ocrText } = await processMessagesWithOCR(...)

// Step 3.5: NLP Classification
const nlpResult = await nlpClassifier.classify(
  ocrText || text,
  ocrText ? 'ocr' : 'inline_chat',
  { sourceUrl, sessionKey }
)

// Route classified input for agent allocations
const classifiedWithAllocations = inputCoordinator.routeClassifiedInput(
  nlpResult.input,
  agents,
  agentBoxes,
  fallbackModel,
  'ollama'
)

// Step 4: Handle routing decision
// Use classifiedWithAllocations.agentAllocations for dispatch
```

### InputCoordinator

The `InputCoordinator.routeClassifiedInput()` method:

1. Takes pre-extracted triggers from ClassifiedInput
2. Matches against agent listener configurations
3. Populates `agentAllocations` with:
   - Full reasoning (goals, role, rules)
   - LLM provider and model from connected AgentBox
   - Output slot destination

## Testing

Run unit tests:

```bash
cd apps/extension-chromium
npm test -- --testPathPattern=NlpClassifier
```

### Manual Test Flow

1. Open the WR Chat sidepanel
2. Enter: `Bitte trage den Termin am 17.8. ein #termin17 #buchhaltung`
3. Check console logs for:
   ```
   [Chat] NLP Classification: {
     triggers: ["#termin17", "#buchhaltung"],
     entities: 3,
     processingTimeMs: 15
   }
   ```
4. Verify triggers route to configured agents
5. Verify output appears in correct AgentBox

## Licensing

wink-nlp is licensed under MIT. The license is included in:
`THIRD_PARTY_LICENSES/wink-nlp-MIT.txt`

**Important:** If updating wink-nlp, ensure the license file remains current.

## Files

| File | Purpose |
|------|---------|
| `src/nlp/types.ts` | TypeScript interfaces |
| `src/nlp/NlpClassifier.ts` | Main classifier with wink-nlp |
| `src/nlp/index.ts` | Module exports |
| `src/nlp/__tests__/NlpClassifier.test.ts` | Unit tests |
| `src/services/InputCoordinator.ts` | Routing with agent allocations |

