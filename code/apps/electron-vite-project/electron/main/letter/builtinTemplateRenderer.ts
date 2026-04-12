/**
 * Generate .docx for Path A (built-in letter layouts) via the `docx` library.
 */

import * as fs from 'fs'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} from 'docx'

export interface BuiltinRenderOptions {
  layout: string
  fields: Record<string, string>
  logoPath?: string | null
}

type LogoBytes = { buffer: Buffer; type: 'png' | 'jpg' }

const A4_WIDTH = 11906
const A4_HEIGHT = 16838

function parseDataUrlImage(dataUrl: string): LogoBytes | null {
  const m = dataUrl.trim().match(/^data:image\/(png|jpeg|jpg|svg\+xml);base64,(.+)$/i)
  if (!m) return null
  const kind = m[1].toLowerCase()
  if (kind === 'svg+xml') return null
  const imageType = kind === 'png' ? 'png' : 'jpg'
  try {
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length < 16 || buf.length > 12 * 1024 * 1024) return null
    return { buffer: buf, type: imageType }
  } catch {
    return null
  }
}

function loadLogo(options: BuiltinRenderOptions): LogoBytes | null {
  const raw = (options.logoPath?.trim() || options.fields.company_logo?.trim() || '') as string
  if (!raw) return null
  if (raw.startsWith('data:image/')) {
    return parseDataUrlImage(raw)
  }
  if (raw.length > 4096) return null
  try {
    const resolved = fs.realpathSync(raw)
    if (!fs.existsSync(resolved)) return null
    const low = resolved.toLowerCase()
    if (low.endsWith('.png')) {
      return { buffer: fs.readFileSync(resolved), type: 'png' }
    }
    if (low.endsWith('.jpg') || low.endsWith('.jpeg')) {
      return { buffer: fs.readFileSync(resolved), type: 'jpg' }
    }
  } catch {
    return null
  }
  return null
}

function layoutPageMargins(layout: string): { top: number; right: number; bottom: number; left: number } {
  const din = { top: 1134, right: 1134, bottom: 1134, left: 1418 }
  switch (layout) {
    case 'din5008b':
      return { ...din, top: 1700 }
    case 'classic':
      return { top: 1440, right: 1440, bottom: 1440, left: 1440 }
    case 'modern':
    case 'minimal':
      return { top: 1134, right: 1134, bottom: 1134, left: 1134 }
    default:
      return din
  }
}

function logoAlignment(layout: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (layout === 'classic') return AlignmentType.CENTER
  if (layout === 'modern' || layout === 'minimal') return AlignmentType.LEFT
  return AlignmentType.RIGHT
}

function senderLineAlignment(layout: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (layout === 'classic') return AlignmentType.CENTER
  return AlignmentType.LEFT
}

function recipientSpacingBefore(layout: string): number {
  if (layout === 'din5008b') return 600
  if (layout === 'modern') return 200
  return 400
}

function buildBodyParagraphs(f: Record<string, string>): Paragraph[] {
  const body = f.body?.trim()
  if (!body) return []
  return body.split(/\n\n+/).map(
    (para) =>
      new Paragraph({
        children: [new TextRun({ text: para.trim(), size: 22, font: 'Liberation Sans' })],
        spacing: {
          after: 200,
          line: 276,
        },
      }),
  )
}

function getImageDimensions(buffer: Buffer, type: 'png' | 'jpg'): { width: number; height: number } {
  try {
    if (type === 'png') {
      if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
        const width = buffer.readUInt32BE(16)
        const height = buffer.readUInt32BE(20)
        if (width > 0 && height > 0) return { width, height }
      }
    }
    if (type === 'jpg') {
      let offset = 2
      while (offset < buffer.length - 10) {
        if (buffer[offset] === 0xff) {
          const marker = buffer[offset + 1]
          if (marker === 0xc0 || marker === 0xc2) {
            const height = buffer.readUInt16BE(offset + 5)
            const width = buffer.readUInt16BE(offset + 7)
            if (width > 0 && height > 0) return { width, height }
          }
          const len = buffer.readUInt16BE(offset + 2)
          offset += 2 + len
        } else {
          offset++
        }
      }
    }
  } catch {
    /* fallback below */
  }
  return { width: 300, height: 100 }
}

function buildDocument(layout: string, f: Record<string, string>, logo: LogoBytes | null): Document {
  const children: Paragraph[] = []
  const margins = layoutPageMargins(layout)
  const rec = f as Record<string, string | undefined>

  if (logo) {
    const dims = getImageDimensions(logo.buffer, logo.type)
    const maxWidth = 250
    const maxHeight = 100
    let w = dims.width
    let h = dims.height
    if (w > maxWidth) {
      h = Math.round(h * (maxWidth / w))
      w = maxWidth
    }
    if (h > maxHeight) {
      w = Math.round(w * (maxHeight / h))
      h = maxHeight
    }
    w = Math.max(w, 40)
    h = Math.max(h, 20)

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: logo.type,
            data: logo.buffer,
            transformation: { width: w, height: h },
          }),
        ],
        alignment: logoAlignment(layout),
        spacing: { after: 100 },
      }),
    )
  }

  const senderData =
    rec.sender?.trim() || [rec.sender_name, rec.sender_address].filter((x) => x?.trim()).join('\n')
  const senderPhone = rec.sender_phone?.trim() || ''
  const senderEmail = rec.sender_email?.trim() || ''

  if (senderData) {
    const senderLines = senderData.split('\n').filter((l) => l.trim())
    const returnLine = senderLines.join(' · ')
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: returnLine,
            size: 12,
            font: 'Liberation Sans',
            color: '999999',
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
        alignment: senderLineAlignment(layout),
        spacing: { after: 40 },
      }),
    )
  }

  const recipientBlock = rec.recipient?.trim()
    ? rec.recipient
    : [rec.recipient_name, rec.recipient_address].filter((x) => x?.trim()).join('\n')
  if (recipientBlock?.trim()) {
    children.push(
      new Paragraph({
        children: [],
        spacing: { before: recipientSpacingBefore(layout), after: 0 },
      }),
    )

    let recipientLines = recipientBlock.split('\n').map((l) => l.trim()).filter(Boolean)

    if (recipientLines.length === 1 && recipientLines[0].length > 30) {
      const line = recipientLines[0]
      const parts = line.split(/,\s+/)
      if (parts.length > 1) {
        recipientLines = parts.map((p) => p.trim()).filter(Boolean)
      }
    }

    for (const line of recipientLines) {
      if (line) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 22, font: 'Liberation Sans' })],
            spacing: { after: 0 },
          }),
        )
      }
    }
    children.push(new Paragraph({ children: [], spacing: { after: 400 } }))
  }

  // --- DATE (always today's date for the letter being created) ---
  {
    const now = new Date()
    const dd = String(now.getDate()).padStart(2, '0')
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const yyyy = now.getFullYear()
    const todayFormatted = `${dd}.${mm}.${yyyy}`
    children.push(
      new Paragraph({
        children: [new TextRun({ text: todayFormatted, size: 22, font: 'Liberation Sans' })],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 300 },
      }),
    )
  }

  if (f.subject?.trim()) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: f.subject.trim(),
            size: 24,
            font: 'Liberation Sans',
            bold: true,
          }),
        ],
        spacing: { after: 300 },
      }),
    )
  }

  if (f.salutation?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.salutation.trim(), size: 22, font: 'Liberation Sans' })],
        spacing: { after: 200 },
      }),
    )
  }

  children.push(...buildBodyParagraphs(f))

  if (f.closing?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.closing.trim(), size: 22, font: 'Liberation Sans' })],
        spacing: { before: 400, after: 200 },
      }),
    )
  }

  if (f.signer_name?.trim()) {
    children.push(
      new Paragraph({
        children: [],
        spacing: { after: 600 },
      }),
    )
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.signer_name.trim(), size: 22, font: 'Liberation Sans' })],
      }),
    )
  }

  const footerChildren: Paragraph[] = []
  if (senderData || senderPhone || senderEmail) {
    footerChildren.push(
      new Paragraph({
        children: [],
        border: {
          top: {
            color: 'CCCCCC',
            style: BorderStyle.SINGLE,
            size: 4,
          },
        },
        spacing: { after: 40 },
      }),
    )

    const senderLines = (senderData || '').split('\n').filter((l) => l.trim())
    const senderName = senderLines[0] || ''
    const senderAddr = senderLines.slice(1).join(', ')

    if (senderName) {
      footerChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: senderName,
              size: 14,
              font: 'Liberation Sans',
              color: '666666',
              bold: true,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 20 },
        }),
      )
    }

    if (senderAddr) {
      footerChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: senderAddr,
              size: 14,
              font: 'Liberation Sans',
              color: '888888',
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 20 },
        }),
      )
    }

    const contactLine = [senderPhone ? `Tel: ${senderPhone}` : '', senderEmail].filter(Boolean).join(' · ')
    if (contactLine) {
      footerChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: contactLine,
              size: 14,
              font: 'Liberation Sans',
              color: '888888',
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
      )
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Liberation Sans',
            size: 22,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH, height: A4_HEIGHT },
            margin: margins,
          },
        },
        footers:
          footerChildren.length > 0
            ? {
                default: new Footer({ children: footerChildren }),
              }
            : undefined,
        children,
      },
    ],
  })
}

export async function renderBuiltinTemplate(options: BuiltinRenderOptions): Promise<Buffer> {
  const logo = loadLogo(options)
  const doc = buildDocument(options.layout || 'din5008a', options.fields, logo)
  return Buffer.from(await Packer.toBuffer(doc))
}
