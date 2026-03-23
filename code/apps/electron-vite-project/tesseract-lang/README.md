# Tesseract Language Data

This directory holds `.traineddata` files for offline OCR in the packaged Electron app.

## Why this exists

In development, Tesseract.js downloads language data from the projectnaptha CDN automatically.
In a packaged app you may want OCR to work without internet access. Placing `eng.traineddata`
here causes `electron-builder.config.cjs` to bundle it into `resources/tesseract-lang/` and
`ocr-service.ts` to use it instead of the CDN.

If the file is **absent**, OCR still works as long as the machine has internet access — the
worker falls back to the CDN automatically.

## Download

Download the LSTM best-accuracy model (~12 MB):

```bash
# PowerShell
Invoke-WebRequest `
  -Uri "https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata" `
  -OutFile "eng.traineddata"

# curl (Linux / macOS / Git Bash)
curl -L -o eng.traineddata \
  "https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata"
```

For additional languages (e.g. German):

```bash
# deu.traineddata
curl -L -o deu.traineddata \
  "https://github.com/tesseract-ocr/tessdata_best/raw/main/deu.traineddata"
```

Place each `.traineddata` file directly in this directory (no subdirectories).

## Git

These files are large — add them to `.gitignore` or use Git LFS:

```
# .gitignore
apps/electron-vite-project/tesseract-lang/*.traineddata
```
