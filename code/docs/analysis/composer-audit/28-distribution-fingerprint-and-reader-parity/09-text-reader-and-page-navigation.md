# Text reader and page navigation

## Reader component

**`BeapDocumentReaderModal`** — `apps/extension-chromium/src/beap-builder/components/BeapDocumentReaderModal.tsx`

- **Paging:** `splitToSyntheticPages(semanticContent, charsPerPage)` — **synthetic** pages (paragraph/chunk split), not PDF page thumbnails.
- **Left rail:** Layout uses a **sidebar** (`sidebarBg`) with **page list** / navigation — **this is the “page-navigation rail”** (see component JSX below modal header; file continues past line 120).

## Inline usage

`BeapInlineComposer.tsx` ~800–806:

```tsx
<BeapDocumentReaderModal
  open={readerOpen}
  onClose={() => setReaderOpen(false)}
  filename={readerFilename}
  semanticContent={readerText}
  theme="standard"
/>
```

**Reader is already mounted** when user has text; **rail** is inside the modal. **Regression** vs product expectation is therefore **not** “modal missing” but **workflow**: no **badge**, no **consistent open path** from list (only **View text** / auto-open on add), and **`theme="standard"`** while composer chrome is **dark** (visual discontinuity).

## Legacy popup

Same `BeapDocumentReaderModal` from `./beap-builder/components` — **shared component**, **reusable directly** in Electron (already aliased `@ext/beap-builder`).

## Parity gap summary

| Item | Legacy | Inline |
|------|--------|--------|
| Modal + rail | Yes | Yes (same component) |
| Green Parsed badge | Yes (`AttachmentStatusBadge`) | No |
| Extracting… state | Yes (`pending`) | No (sync/await until done) |
| Theming | Often `dark`/`standard` with app theme | Fixed `standard` |
