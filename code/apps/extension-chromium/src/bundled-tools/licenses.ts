/**
 * License Data for Bundled Tools
 * 
 * Contains full license texts and metadata for Apache Tika and PDFium.
 * These are the mandatory bundled components for BEAP parsing and rasterization.
 * 
 * @version 1.0.0
 */

import type { LicenseInfo, LicenseIdentifier } from './types'

// =============================================================================
// Apache License 2.0 Full Text
// =============================================================================

const APACHE_2_0_TEXT = `
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
      copyright notice that is included in or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to the Licensor for inclusion in the Work by the copyright
      owner or by an individual or Legal Entity authorized to submit on
      behalf of the copyright owner.

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
      use, offer to sell, sell, import, and otherwise transfer the Work.

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
          attribution notices from the Source form of the Work; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law or agreed to in writing, shall
      any Contributor be liable to You for damages, including any direct,
      indirect, special, incidental, or consequential damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License.

   END OF TERMS AND CONDITIONS
`.trim()

// =============================================================================
// BSD 3-Clause License Full Text
// =============================================================================

const BSD_3_CLAUSE_TEXT = `
BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

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
`.trim()

// =============================================================================
// License Registry
// =============================================================================

/**
 * License templates by identifier
 */
export const LICENSE_TEMPLATES: Record<LicenseIdentifier, { name: string; text: string }> = {
  'Apache-2.0': {
    name: 'Apache License 2.0',
    text: APACHE_2_0_TEXT
  },
  'BSD-3-Clause': {
    name: 'BSD 3-Clause License',
    text: BSD_3_CLAUSE_TEXT
  },
  'BSD-2-Clause': {
    name: 'BSD 2-Clause License',
    text: '' // Not used for current tools
  },
  'MIT': {
    name: 'MIT License',
    text: '' // Not used for current tools
  },
  'ISC': {
    name: 'ISC License',
    text: '' // Not used for current tools
  }
}

// =============================================================================
// Bundled Tool Licenses
// =============================================================================

/**
 * Apache Tika license information
 */
export const APACHE_TIKA_LICENSE: LicenseInfo = {
  identifier: 'Apache-2.0',
  name: 'Apache License 2.0',
  copyrightHolders: ['The Apache Software Foundation'],
  fullText: APACHE_2_0_TEXT,
  upstreamUrl: 'https://tika.apache.org/'
}

/**
 * PDFium license information
 */
export const PDFIUM_LICENSE: LicenseInfo = {
  identifier: 'BSD-3-Clause',
  name: 'BSD 3-Clause License',
  copyrightHolders: ['The PDFium Authors', 'Google Inc.'],
  fullText: BSD_3_CLAUSE_TEXT,
  upstreamUrl: 'https://pdfium.googlesource.com/pdfium/'
}

// =============================================================================
// All Bundled Tool Licenses (for UI display)
// =============================================================================

export interface BundledToolLicenseEntry {
  /** Tool ID */
  id: string
  
  /** Display name */
  name: string
  
  /** Short description */
  description: string
  
  /** Category */
  category: 'parser' | 'rasterizer'
  
  /** Version (placeholder until actual install) */
  version: string
  
  /** License info */
  license: LicenseInfo
}

/**
 * All bundled tools with license information
 * Used for Third Party Licenses view
 */
export const BUNDLED_TOOL_LICENSES: BundledToolLicenseEntry[] = [
  {
    id: 'apache-tika',
    name: 'Apache Tika',
    description: 'Content analysis toolkit for extracting and normalizing textual semantics from documents. Supports PDF, DOCX, XLSX, PPTX, HTML, TXT, and Markdown.',
    category: 'parser',
    version: '2.9.1',
    license: APACHE_TIKA_LICENSE
  },
  {
    id: 'pdfium',
    name: 'PDFium',
    description: 'PDF rendering engine for deterministic rasterization of documents into non-executable images (WebP/PNG). Used for previews, reconstruction reference, and integrity anchoring.',
    category: 'rasterizer',
    version: '6312',
    license: PDFIUM_LICENSE
  }
]

/**
 * Get license info for a specific tool
 */
export function getLicenseForTool(toolId: string): LicenseInfo | null {
  const entry = BUNDLED_TOOL_LICENSES.find(t => t.id === toolId)
  return entry?.license ?? null
}

/**
 * Check if a license identifier is permissive (non-copyleft)
 * AGPL/GPL are NOT allowed
 */
export function isPermissiveLicense(identifier: LicenseIdentifier): boolean {
  const permissive: LicenseIdentifier[] = [
    'Apache-2.0',
    'BSD-3-Clause',
    'BSD-2-Clause',
    'MIT',
    'ISC'
  ]
  return permissive.includes(identifier)
}

