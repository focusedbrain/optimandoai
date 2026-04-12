/**
 * Generate .docx for Path A (built-in letter layouts) via the `docx` library.
 */

import * as fs from 'fs'
import {
  AlignmentType,
  Document,
  Footer,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
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
        children: [new TextRun({ text: para.trim(), size: 22, font: 'Arial' })],
        spacing: { after: 200 },
      }),
  )
}

function buildDocument(layout: string, f: Record<string, string>, logo: LogoBytes | null): Document {
  const children: Paragraph[] = []
  const margins = layoutPageMargins(layout)

  if (logo) {
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: logo.type,
            data: logo.buffer,
            transformation: { width: 180, height: 50 },
          }),
        ],
        alignment: logoAlignment(layout),
        spacing: { after: 200 },
      }),
    )
  }

  if (f.sender_name || f.sender_address) {
    const addrFirst = f.sender_address?.split('\n')[0]?.trim()
    const senderLine = [f.sender_name?.trim(), addrFirst].filter(Boolean).join(', ')
    if (senderLine) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: senderLine, size: 14, font: 'Arial', color: '888888' })],
          alignment: senderLineAlignment(layout),
          spacing: { after: 100 },
        }),
      )
    }
  }

  const recipientBlock = f.recipient?.trim()
    ? f.recipient
    : [f.recipient_name, f.recipient_address].filter((x) => x?.trim()).join('\n')
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
            children: [new TextRun({ text: t, size: 22, font: 'Arial' })],
          }),
        )
      }
    }
    children.push(new Paragraph({ children: [], spacing: { after: 400 } }))
  }

  if (f.date?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.date.trim(), size: 22, font: 'Arial' })],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
      }),
    )
  }

  if (f.subject?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.subject.trim(), size: 22, font: 'Arial', bold: true })],
        spacing: { after: 200 },
      }),
    )
  }

  if (f.salutation?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.salutation.trim(), size: 22, font: 'Arial' })],
        spacing: { after: 200 },
      }),
    )
  }

  children.push(...buildBodyParagraphs(f))

  if (f.closing?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.closing.trim(), size: 22, font: 'Arial' })],
        spacing: { before: 400, after: 400 },
      }),
    )
  }

  if (f.signer_name?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: f.signer_name.trim(), size: 22, font: 'Arial' })],
      }),
    )
  }

  const footerParts = [f.sender_phone?.trim(), f.sender_email?.trim()].filter(Boolean)
  const footerChildren =
    footerParts.length > 0
      ? [
          new Paragraph({
            children: [
              new TextRun({
                text: footerParts.join(' · '),
                size: 16,
                font: 'Arial',
                color: '888888',
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ]
      : []

  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
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
