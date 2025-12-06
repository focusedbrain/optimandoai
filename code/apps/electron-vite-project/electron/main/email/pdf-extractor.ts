/**
 * PDF Text Extractor
 * 
 * Extracts text content from PDF attachments.
 * This runs server-side in Electron - PDFs are never rendered in the browser.
 * 
 * TODO: Full implementation with pdf-parse or similar library
 * Current implementation provides a working abstraction with basic extraction.
 */

import { ExtractedAttachmentText } from './types'

/**
 * PDF extraction result
 */
interface PdfExtractionResult {
  success: boolean
  text: string
  pageCount: number
  warnings: string[]
  error?: string
}

/**
 * Check if a buffer looks like a PDF
 */
function isPdfBuffer(buffer: Buffer): boolean {
  // PDF files start with %PDF-
  return buffer.length > 4 && 
         buffer[0] === 0x25 && // %
         buffer[1] === 0x50 && // P
         buffer[2] === 0x44 && // D
         buffer[3] === 0x46    // F
}

/**
 * Basic PDF text extraction using simple heuristics
 * 
 * This is a simplified extractor that handles basic PDFs.
 * For production use, consider pdf-parse, pdf.js, or similar library.
 */
function extractTextBasic(buffer: Buffer): PdfExtractionResult {
  const warnings: string[] = []
  
  if (!isPdfBuffer(buffer)) {
    return {
      success: false,
      text: '',
      pageCount: 0,
      warnings: [],
      error: 'Invalid PDF: Missing PDF header'
    }
  }
  
  try {
    const content = buffer.toString('binary')
    const textParts: string[] = []
    
    // Try to find text streams in the PDF
    // This is a simplified approach that works for many PDFs
    
    // Look for text between BT (begin text) and ET (end text) markers
    const btEtRegex = /BT[\s\S]*?ET/g
    const textBlocks = content.match(btEtRegex) || []
    
    for (const block of textBlocks) {
      // Extract text from Tj and TJ operators
      
      // Handle Tj operator: (text) Tj
      const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g) || []
      for (const match of tjMatches) {
        const textMatch = match.match(/\(([^)]*)\)/)
        if (textMatch && textMatch[1]) {
          textParts.push(decodePdfString(textMatch[1]))
        }
      }
      
      // Handle TJ operator (array of text): [(text1) (text2)] TJ
      const tjArrayMatches = block.match(/\[([^\]]*)\]\s*TJ/g) || []
      for (const match of tjArrayMatches) {
        const arrayContent = match.match(/\[([^\]]*)\]/)
        if (arrayContent && arrayContent[1]) {
          const parts = arrayContent[1].match(/\(([^)]*)\)/g) || []
          for (const part of parts) {
            const textMatch = part.match(/\(([^)]*)\)/)
            if (textMatch && textMatch[1]) {
              textParts.push(decodePdfString(textMatch[1]))
            }
          }
        }
      }
    }
    
    // Also look for stream objects with text
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g
    let streamMatch
    while ((streamMatch = streamRegex.exec(content)) !== null) {
      const streamContent = streamMatch[1]
      // Look for readable ASCII text in streams
      const asciiText = streamContent.match(/[A-Za-z0-9\s.,!?;:'"()\-]{20,}/g) || []
      if (asciiText.length > 0) {
        // Only add if it looks like natural language
        for (const text of asciiText) {
          if (/[aeiou]/i.test(text) && /\s/.test(text)) {
            textParts.push(text)
          }
        }
      }
    }
    
    // Count pages
    const pageCount = (content.match(/\/Type\s*\/Page[^s]/g) || []).length
    
    // Clean up and join text
    let extractedText = textParts.join(' ')
    
    // Clean up the text
    extractedText = extractedText
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable chars
      .trim()
    
    if (!extractedText) {
      warnings.push('Could not extract readable text. PDF may be scanned or use embedded fonts.')
    }
    
    return {
      success: true,
      text: extractedText,
      pageCount: pageCount || 1,
      warnings
    }
    
  } catch (err: any) {
    return {
      success: false,
      text: '',
      pageCount: 0,
      warnings: [],
      error: `Extraction error: ${err.message}`
    }
  }
}

/**
 * Decode PDF string escapes
 */
function decodePdfString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
}

/**
 * Extract text from a PDF buffer
 * 
 * This is the main entry point for PDF text extraction.
 * The PDF is processed entirely server-side.
 * 
 * @param buffer - PDF file content as Buffer
 * @returns Extracted text and metadata
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedAttachmentText & { success: boolean; error?: string }> {
  const result = extractTextBasic(buffer)
  
  return {
    attachmentId: '', // Will be set by caller
    text: result.text,
    pageCount: result.pageCount,
    warnings: result.warnings,
    success: result.success,
    error: result.error
  }
}

/**
 * Check if a file is a PDF based on MIME type or extension
 */
export function isPdfFile(mimeType: string, filename?: string): boolean {
  if (mimeType === 'application/pdf') {
    return true
  }
  
  if (filename && filename.toLowerCase().endsWith('.pdf')) {
    return true
  }
  
  return false
}

/**
 * Get supported document types for text extraction
 */
export function getSupportedExtractionTypes(): string[] {
  return [
    'application/pdf'
    // TODO: Add more types as needed:
    // 'application/msword',
    // 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // 'text/plain',
    // 'text/csv'
  ]
}

/**
 * Check if a MIME type supports text extraction
 */
export function supportsTextExtraction(mimeType: string): boolean {
  return getSupportedExtractionTypes().includes(mimeType)
}

