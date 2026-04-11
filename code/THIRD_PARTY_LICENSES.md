# WR Desk™ — Third-Party Licenses

Dieses Dokument listet Open-Source-Bibliotheken und zugehörige Lizenzinformationen, die mit **WR Desk** in der **Electron-Desktop-App**, der **Chromium-Erweiterung** und dem **Monorepo-Root** als **Runtime-Dependencies** (`dependencies` in den jeweiligen `package.json`) vorgesehen sind, sowie ergänzende Hinweise zu **Electron** (Laufzeit-Framework) und **externen Tools**.

**Volltexte** vieler Standardlizenzen stehen am Ende dieses Dokuments. Zusätzlich liegen historische/komponentenspezifische Kopien unter `THIRD_PARTY_LICENSES/*.txt` und unter `apps/electron-vite-project/THIRD_PARTY_LICENSES/` — diese Ordner werden **nicht** ersetzt, sondern durch dieses Dokument **ergänzt**.

**Stand:** April 2026  
**Manifest-Versionen:** wie in `code/code/package.json`, `code/code/apps/electron-vite-project/package.json`, `code/code/apps/extension-chromium/package.json` angegeben (Semver-Ranges).

---

## Übersicht: Monorepo-Pakete (First-Party)

Diese Pakete sind **private** Workspace-Module (`workspace:*`) und **keine** separaten npm-Drittanbieter-Bibliotheken. Ihre Lizenzierung erfolgt über die **Projektlizenz** (siehe Root-`LICENSE`).

| Package | Version (manifest) | Genutzt in |
|---------|-------------------|------------|
| `@repo/ingestion-core` | `workspace:*` | Electron-App |
| `@repo/shared-beap-ui` | `workspace:*` | Electron-App |

---

## MIT License

*Vollständiger Referenztext: [MIT License (Referenz)](#mit-license-referenz).*

| Package | Version (manifest) | Copyright / Hinweis (npm bzw. Fallback) | Repository | Genutzt in |
|---------|-------------------|-------------------------------------------|------------|------------|
| `@noble/curves` | Electron `^1.9.7`, Extension `^1.4.0` | Copyright (c) Paul Miller | [github.com/paulmillr/noble-curves](https://github.com/paulmillr/noble-curves) | Beide |
| `@noble/post-quantum` | `^0.2.1` | Copyright (c) Paul Miller | [github.com/paulmillr/noble-post-quantum](https://github.com/paulmillr/noble-post-quantum) | Electron-App |
| `@noble/ed25519` | `^2.1.0` | Copyright (c) Paul Miller | [github.com/paulmillr/noble-ed25519](https://github.com/paulmillr/noble-ed25519) | Chrome Extension |
| `@types/express` | `^5.0.5` | Copyright (c) DefinitelyTyped contributors | [github.com/DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) (types/express) | Electron-App |
| `@types/imap` | `^0.8.42` | Copyright (c) DefinitelyTyped contributors | [github.com/DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) (types/imap) | Electron-App |
| `@types/mailparser` | `^3.4.6` | Copyright (c) DefinitelyTyped contributors | [github.com/DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) (types/mailparser) | Electron-App |
| `@types/nodemailer` | `^7.0.4` | Copyright (c) DefinitelyTyped contributors | [github.com/DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) (types/nodemailer) | Electron-App |
| `@types/ws` | `^8.18.1` | Copyright (c) DefinitelyTyped contributors | [github.com/DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) (types/ws) | Electron-App |
| `better-sqlite3` | `^11.10.0` | Copyright (c) Joshua Wise | [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Electron-App |
| `body-parser` | `^2.2.0` | Copyright (c) body-parser contributors (siehe npm: u. a. Douglas Christopher Wilson, Jonathan Ong) | [github.com/expressjs/body-parser](https://github.com/expressjs/body-parser) | Electron-App |
| `canvas` | Root `^3.2.0`, Electron `3.2.0` | Copyright (c) TJ Holowaychuk; Mitwirkende siehe npm | [github.com/Automattic/node-canvas](https://github.com/Automattic/node-canvas) | Monorepo-Root + Electron-App |
| `docx` | `^9.6.1` | Copyright (c) Dolan Miu | [github.com/dolanmiu/docx](https://github.com/dolanmiu/docx) | Electron-App |
| `express` | `^5.1.0` | Copyright (c) express contributors (siehe npm) | [github.com/expressjs/express](https://github.com/expressjs/express) | Electron-App |
| `imap` | `^0.8.19` | Copyright (c) Brian White (npm `author`; Legacy-Feld `licenses`: MIT) | [github.com/mscdex/node-imap](https://github.com/mscdex/node-imap) | Electron-App |
| `is-electron` | `^2.2.2` | Copyright (c) Cheton Wu | [github.com/cheton/is-electron](https://github.com/cheton/is-electron) | Electron-App |
| `jose` | `^5.2.0` | Copyright (c) Filip Skokan | [github.com/panva/jose](https://github.com/panva/jose) | Electron-App |
| `keytar` | `^7.9.0` | Copyright (c) keytar contributors (npm: kein `author`-Feld) | [github.com/atom/node-keytar](https://github.com/atom/node-keytar) | Electron-App |
| `mailparser` | `^3.9.0` | Copyright (c) Andris Reinman | [github.com/nodemailer/mailparser](https://github.com/nodemailer/mailparser) | Electron-App |
| `node-fetch` | `2.7.0` | Copyright (c) David Frank | [github.com/node-fetch/node-fetch](https://github.com/node-fetch/node-fetch) | Electron-App |
| `open` | `^8.4.2` | Copyright (c) Sindre Sorhus | [github.com/sindresorhus/open](https://github.com/sindresorhus/open) | Electron-App |
| `pg` | `^8.16.3` | Copyright (c) Brian Carlson | [github.com/brianc/node-postgres](https://github.com/brianc/node-postgres) | Electron-App |
| `react` | `^18.2.0` | Copyright (c) react contributors (npm: kein `author`; siehe Paket-LICENSE) | [github.com/facebook/react](https://github.com/facebook/react) | Beide |
| `react-dom` | `^18.2.0` | Copyright (c) react-dom contributors (npm: kein `author`) | [github.com/facebook/react](https://github.com/facebook/react) | Beide |
| `react-markdown` | `^9.0.1` | Copyright (c) Espen Hovlandsdal | [github.com/remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) | Chrome Extension |
| `recharts` | `^3.8.0` | Copyright (c) recharts group (npm) | [github.com/recharts/recharts](https://github.com/recharts/recharts) | Electron-App |
| `regenerator-runtime` | `^0.14.1` | Copyright (c) Ben Newman | [github.com/facebook/regenerator](https://github.com/facebook/regenerator) | Electron-App |
| `whatwg-url` | `^5.0.0` | Copyright (c) Sebastian Mayr | [github.com/jsdom/whatwg-url](https://github.com/jsdom/whatwg-url) | Electron-App |
| `zod` | `^3.22.4` | Copyright (c) Colin McDonnell | [github.com/colinhacks/zod](https://github.com/colinhacks/zod) | Beide |
| `zustand` | Electron `^5.0.11`, Extension `^5.0.9` | Copyright (c) Paul Henschel; Mitwirkende siehe npm | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand) | Beide |
| `wink-eng-lite-web-model` | `^1.8.1` | Copyright (c) Sanjaya Kumar Saxena | [github.com/winkjs/wink-eng-lite-web-model](https://github.com/winkjs/wink-eng-lite-web-model) | Chrome Extension |
| `wink-nlp` | `^2.4.0` | Copyright (c) Sanjaya Kumar Saxena | [github.com/winkjs/wink-nlp](https://github.com/winkjs/wink-nlp) | Chrome Extension |
| `ws` | `^8.18.3` | Copyright (c) Einar Otto Stangvik | [github.com/websockets/ws](https://github.com/websockets/ws) | Chrome Extension (Runtime). *Hinweis:* In der Electron-App zusätzlich als **`devDependency`** eingetragen — typischerweise **nicht** Bestandteil der ausgelieferten App, sofern nicht separat gebündelt. |

---

## Apache License 2.0

*Vollständiger Referenztext: [Apache License 2.0 (Referenz)](#apache-license-20-referenz).*

**NOTICE:** Apache-2.0-Pakete können zusätzliche **`NOTICE`**-Dateien im jeweiligen Paketroot enthalten (nach `npm install` unter `node_modules/<paket>/`). Für **PDF.js** liegt im Repo bereits ein Text unter `THIRD_PARTY_LICENSES/pdfjs-Apache-2.0.txt`; für **TensorFlow.js** unter `THIRD_PARTY_LICENSES/tensorflowjs-Apache-2.0.txt`; für **Tesseract (OCR)** unter `THIRD_PARTY_LICENSES/tesseract-ocr-Apache-2.0.txt`.

| Package | Version (manifest) | Copyright / Hinweis | Repository | Genutzt in |
|---------|-------------------|---------------------|------------|------------|
| `pdfjs-dist` | `4.10.38` | Copyright (c) pdfjs-dist contributors (Mozilla PDF.js; npm: kein `author`) | [github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js) | Beide |
| `tesseract.js` | `^5.1.1` | Copyright (c) tesseract.js contributors (npm: u. a. Contributor jeromewu) | [github.com/naptha/tesseract.js](https://github.com/naptha/tesseract.js) | Electron-App |
| `@tensorflow/tfjs` | `^4.22.0` | Copyright (c) @tensorflow/tfjs contributors (npm: kein `author`) | [github.com/tensorflow/tfjs](https://github.com/tensorflow/tfjs) | Chrome Extension |

**Hinweis `tesseract.js`:** Laufzeitabhängigkeiten (Worker, WASM aus `tesseract.js-core` u. a.) können **eigene** Copyright-/Notice-Zeilen mitbringen — gebündelte Artefakte nach Build prüfen. Volltext: `THIRD_PARTY_LICENSES/tesseractjs-Apache-2.0.txt`. Siehe auch die WASM-Extraktion in `electron-builder.config.cjs`.

---

## BSD 2-Clause License

*Vollständiger Referenztext: [BSD 2-Clause License (Referenz)](#bsd-2-clause-license-referenz).*

| Package | Version (manifest) | Copyright / Hinweis | Repository | Genutzt in |
|---------|-------------------|---------------------|------------|------------|
| `mammoth` | `^1.12.0` | Copyright (c) Michael Williamson | [github.com/mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) | Electron-App (u. a. Letter Composer / DOCX) |

---

## ISC License

*Vollständiger Referenztext: [ISC License (Referenz)](#isc-license-referenz).*

| Package | Version (manifest) | Copyright / Hinweis | Repository | Genutzt in |
|---------|-------------------|---------------------|------------|------------|
| `libsodium-wrappers` | `^0.7.11` | Copyright (c) Ahmad Ben Mrad; Mitwirkende siehe npm (u. a. Frank Denis) | [github.com/jedisct1/libsodium.js](https://github.com/jedisct1/libsodium.js) | Electron-App |

---

## MIT No Attribution License (SPDX: MIT-0)

*Vollständiger Referenztext: [MIT-0 License (Referenz)](#mit-0-license-referenz).*

| Package | Version (manifest) | Copyright / Hinweis | Repository | Genutzt in |
|---------|-------------------|---------------------|------------|------------|
| `nodemailer` | `^7.0.11` | Copyright (c) Andris Reinman | [github.com/nodemailer/nodemailer](https://github.com/nodemailer/nodemailer) | Electron-App |

---

## Mozilla Public License 2.0 (MPL-2.0)

*Vollständiger Referenztext: [Mozilla Public License 2.0 (Referenz)](#mozilla-public-license-20-referenz).*

| Package | Version (manifest) | Copyright / Hinweis | Repository | Genutzt in |
|---------|-------------------|---------------------|------------|------------|
| `webextension-polyfill` | `^0.12.0` | Copyright (c) Mozilla (npm `author`: Mozilla) | [github.com/mozilla/webextension-polyfill](https://github.com/mozilla/webextension-polyfill) | Chrome Extension |

**Hinweis:** MPL-2.0 kann **dateibezogene** Copyleft-Anforderungen auslösen, wenn MPL-lizenzierter Code modifiziert wird — siehe vollständigen Text.

### webextension-polyfill v0.12.0

- **License:** MPL-2.0 (Mozilla Public License 2.0)
- **Copyright:** Copyright (c) Mozilla and contributors
- **Compliance note:** MPL-2.0 requires that modifications to covered files (files originating from this package) remain under MPL-2.0 and their source be made available. WR Desk uses this package **unmodified** as a runtime dependency in the Chrome extension. No covered files have been modified.
- **Repository:** https://github.com/mozilla/webextension-polyfill

---

## Dual License: (MIT OR GPL-3.0)

| Package | Version (manifest) | Copyright / Hinweis | Repository | Genutzt in |
|---------|-------------------|---------------------|------------|------------|
| `pizzip` | `^3.2.0` | **MIT (elected from MIT OR GPL-3.0).** Copyright (c) Edgar Hipp; Mitwirkende siehe npm | [github.com/open-xml-templating/pizzip](https://github.com/open-xml-templating/pizzip) | Electron-App |

### pizzip v3.2.0

- **License:** MIT (elected from dual-license: MIT OR GPL-3.0)
- **Copyright:** Copyright (c) pizzip contributors (see upstream repository and npm package metadata)
- **Note:** This package is dual-licensed under MIT OR GPL-3.0. WR Desk uses pizzip under the **MIT license** option. The MIT license reference text at the end of this document applies.

---

## Electron (Desktop-Runtime)

Electron wird in `apps/electron-vite-project` als **`devDependency`** (`^30.5.1`) installiert, bildet aber die **Laufzeit** der gebündelten Desktop-App.

| Feld | Wert |
|------|------|
| **Paket** | `electron` |
| **Version (manifest)** | `^30.5.1` (konkrete Version im Build: `electron-builder.config.cjs` → `electronVersion: '30.5.1'`) |
| **Lizenz** | MIT (npm) |
| **Copyright** | Copyright (c) Electron contributors; Copyright (c) 2013–2020 GitHub Inc. (üblicher Electron-MIT-Header; siehe offizielles Electron-`LICENSE`) |
| **Repository** | [github.com/electron/electron](https://github.com/electron/electron) |
| **Hinweis** | Electron bündelt **Chromium** (u. a. BSD-3-Clause-Komponenten) und **Node.js** (MIT). Die vollständigen Drittanbieterhinweise der Electron-Distribution liegen im **Electron-Release** bzw. in den mitgelieferten `LICENSE`-/Chromium-`LICENSE`-Dateien der jeweiligen Plattform-Pakete. |

---

## Begleitende Lizenzdateien (nicht als direkte npm-Dependency gelistet)

Die folgenden Texte im Ordner `THIRD_PARTY_LICENSES/` betreffen **Komponenten oder Binaries**, die **nicht** als eigenständige npm-`dependencies` in den oben genannten Manifesten stehen, aber im Ökosystem (PDF/OCR/Tesseract) relevant sein können oder historisch dokumentiert wurden:

| Datei (im Repo) | Lizenz (Kopfzeile laut Dateiname) | Hinweis |
|-----------------|----------------------------------|---------|
| `pdfium-BSD-3-Clause.txt` | BSD-3-Clause | Häufig im Kontext PDF-Rendering; siehe Referenz [BSD 3-Clause](#bsd-3-clause-license-referenz). |
| `leptonica-BSD-2-Clause.txt` | BSD-2-Clause | Häufig im OCR-/Bildverarbeitungs-Kontext. |
| `tesseract-ocr-Apache-2.0.txt` | Apache-2.0 | Native OCR-Engine (Begleitdokumentation). |
| `apache-tika-Apache-2.0.txt` | Apache-2.0 | Siehe Abschnitt [Externe Tools und Services](#externe-tools-und-services). |

---

## Externe Tools und Services

Diese Komponenten sind **keine** npm-Runtime-Dependencies des Monorepos, können aber **Betrieb/Features** betreffen oder in **Architektur/Dokumentation** vorkommen. Lizenztexte liegen teils bereits unter `THIRD_PARTY_LICENSES/` bzw. `apps/electron-vite-project/THIRD_PARTY_LICENSES/`.

### Apache Tika

- **Lizenz:** Apache-2.0 (Referenzdatei: `THIRD_PARTY_LICENSES/apache-tika-Apache-2.0.txt`)
- **Genutzt für:** Dokument-Textextraktion (Architektur und Extension-Code referenzieren Tika; teils **stubbed** / geplant — siehe u. a. `extension-chromium` Reconstruction-Dienste)
- **Hinweis:** Kein `tika`-npm-Paket in den genannten `package.json`-Manifesten.

### Ollama

- **Lizenz:** MIT (Referenzdatei: `apps/electron-vite-project/THIRD_PARTY_LICENSES/ollama-MIT.txt`)
- **Genutzt für:** Lokaler LLM-/Inferenz-Dienst per **HTTP/API** (Electron-Hauptprozess und UI integrieren **Ollama** als extern laufenden Dienst; **nicht** als npm-Paket gebündelt)
- **Hinweis:** Kein `ollama`-npm-Paket in den genannten `package.json`-Manifesten.

---

## Vollständige Lizenztexte (Referenz)

### MIT License (Referenz)

```text
MIT License

Copyright (c) <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0 (Referenz)

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### BSD 2-Clause License (Referenz)

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause License (Referenz)

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ISC License (Referenz)

```text
ISC License

Copyright (c) <copyright holders>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### MIT-0 License (Referenz)

```text
MIT No Attribution

Copyright <YEAR> <COPYRIGHT HOLDER>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Mozilla Public License 2.0 (Referenz)

Der **vollständige** MPL-2.0-Text liegt u. a. bei Mozilla:

- [https://www.mozilla.org/MPL/2.0/](https://www.mozilla.org/MPL/2.0/) (kanonische HTML-Version)
- [https://raw.githubusercontent.com/mozilla/webextension-polyfill/main/LICENSE](https://raw.githubusercontent.com/mozilla/webextension-polyfill/main/LICENSE) (identisch zum Lizenzfile des hier genutzten Pakets `webextension-polyfill`)

Für die Compliance-Praxis sollten **MPL-lizenzierte Dateien** bei Verteilung klar erkennbar bleiben.

---

*Ende der Datei.*
