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

/** Pixel dimensions from image buffer (PNG IHDR / JPEG SOF) for aspect-preserving logo scaling. */
function readImagePixelSize(logo: LogoBytes): { w: number; h: number } | null {
  const b = logo.buffer
  if (logo.type === 'png' && b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const w = b.readUInt32BE(16)
    const h = b.readUInt32BE(20)
    if (w > 0 && h > 0 && w < 65536 && h < 65536) return { w, h }
  }
  if (logo.type === 'jpg' && b.length > 9) {
    for (let i = 0; i < b.length - 9; i++) {
      if (b[i] !== 0xff) continue
      const m = b[i + 1]
      if (m === 0xc0 || m === 0xc1 || m === 0xc2 || m === 0xc3) {
        const h = b.readUInt16BE(i + 5)
        const w = b.readUInt16BE(i + 7)
        if (w > 0 && h > 0) return { w, h }
      }
    }
  }
  return null
}

/** Max width matches prior docx ImageRun scale; height follows aspect ratio (fallback 200×60). */
function logoTransformation(logo: LogoBytes): { width: number; height: number } {
  const maxW = 200
  const fallbackH = 60
  const dim = readImagePixelSize(logo)
  if (!dim) return { width: maxW, height: fallbackH }
  if (dim.w <= maxW) return { width: dim.w, height: dim.h }
  const scale = maxW / dim.w
  return { width: Math.round(dim.w * scale), height: Math.round(dim.h * scale) }
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

function buildDocument(layout: string, f: Record<string, string>, logo: LogoBytes | null): Document {
  const children: Paragraph[] = []
  const margins = layoutPageMargins(layout)
  const rec = f as Record<string, string | undefined>

  if (logo) {
    const { width: logoWidth, height: logoHeight } = logoTransformation(logo)
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: logo.type,
            data: logo.buffer,
            transformation: { width: logoWidth, height: logoHeight },
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

    if (senderLines.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: senderLines[0],
              size: 20,
              font: 'Liberation Sans',
              bold: true,
            }),
          ],
          spacing: { after: 20 },
        }),
      )
    }

    for (let i = 1; i < senderLines.length; i++) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: senderLines[i],
              size: 18,
              font: 'Liberation Sans',
              color: '555555',
            }),
          ],
          spacing: { after: 0 },
        }),
      )
    }

    const contactParts: string[] = []
    if (senderPhone) contactParts.push(`Tel: ${senderPhone}`)
    if (senderEmail) contactParts.push(senderEmail)
    if (contactParts.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: contactParts.join(' · '),
              size: 18,
              font: 'Liberation Sans',
              color: '555555',
            }),
          ],
          spacing: { after: 100 },
        }),
      )
    }

    children.push(
      new Paragraph({
        children: [],
        border: {
          bottom: {
            color: 'CCCCCC',
            style: BorderStyle.SINGLE,
            size: 4,
          },
        },
        spacing: { after: 200 },
      }),
    )
  }

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
    for (const line of recipientBlock.split('\n')) {
      const t = line.trim()
      if (t) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: t, size: 22, font: 'Liberation Sans' })],
            spacing: { after: 0 },
          }),
        )
      }
    }
    children.push(new Paragraph({ children: [], spacing: { after: 400 } }))
  }

  if (f.date?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.date.trim(), size: 22, font: 'Liberation Sans' })],
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

  const footerParts: string[] = []
  if (senderData) {
    const senderFirstLine = senderData.split('\n')[0]?.trim()
    if (senderFirstLine) footerParts.push(senderFirstLine)
  }
  if (senderPhone) footerParts.push(`Tel: ${senderPhone}`)
  if (senderEmail) footerParts.push(senderEmail)

  const footerChildren: Paragraph[] = []
  if (footerParts.length > 0) {
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
        spacing: { after: 60 },
      }),
    )
    footerChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: footerParts.join(' · '),
            size: 14,
            font: 'Liberation Sans',
            color: '888888',
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    )
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
