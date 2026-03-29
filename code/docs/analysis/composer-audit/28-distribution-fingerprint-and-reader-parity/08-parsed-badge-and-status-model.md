# Parsed badge and status model

## Green “Parsed” badge — source

**Component:** `AttachmentStatusBadge`  
**File:** `apps/extension-chromium/src/beap-builder/components/AttachmentStatusBadge.tsx`

**Success config (evidence):**

```ts
success: { label: 'Parsed', bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'rgba(34,197,94,0.35)' },
```

**Note:** Label text is **`Parsed`**, not the string `"Parsed"` in a separate i18n file — **single source** in `CONFIGS`.

## Status type

`export type AttachmentParseStatus = 'pending' | 'success' | 'failed'`

## Theme prop

`AttachmentStatusBadgeProps` includes `theme?: 'standard' | 'dark'` but the **implementation** (`({ status })`) **does not branch on `theme`** — only `status` selects `CONFIGS`. **Theme is currently unused** for color (dead API surface).

## Inline composer

**Does not** mount `AttachmentStatusBadge`. Equivalent state would require adding **`AttachmentParseStatus`** (or mapping `previewText`/`previewError` to success/failed/pending during async extract).
