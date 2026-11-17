// Text extraction for search and document-aware AI. TXT and DOCX are parsed here (DOCX = ZIP + XML, read with
// node:zlib); native-text PDFs use unpdf. Images/scans: OCR is deferred (status "unsupported"). Never throws.
import { inflateRawSync } from 'node:zlib';
import type { Mime } from './validate.ts';

export const MAX_TEXT = 2_000_000;
export type Extraction = { status: 'done' | 'failed' | 'unsupported'; text: string; error: string };

/** Read one file out of a ZIP via its central directory (stored or deflated entries). */
export function unzipEntry(buf: Buffer, name: string): Buffer | null {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (entryName === name) {
      if (buf.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
      return null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
export function docxText(bytes: Uint8Array): string {
  const xml = unzipEntry(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'word/document.xml');
  if (!xml) throw new Error('word/document.xml not found');
  return decodeXml(xml.toString('utf8').replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractText(bytes: Uint8Array, mime: Mime): Promise<Extraction> {
  try {
    let text = '';
    if (mime === 'text/plain') text = new TextDecoder('utf-8').decode(bytes);
    else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') text = docxText(bytes);
    else if (mime === 'application/pdf') {
      const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const r = await pdfText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join('\n') : r.text;
      if (!text.trim()) return { status: 'unsupported', text: '', error: 'No text layer (scanned PDF); OCR is not available yet.' };
    } else return { status: 'unsupported', text: '', error: 'Images are stored but not searchable yet (OCR not available).' };
    return { status: 'done', text: text.replace(/\u0000/g, '').slice(0, MAX_TEXT), error: '' };
  } catch (e) {
    return { status: 'failed', text: '', error: (e instanceof Error ? e.message : 'extraction failed').slice(0, 200) };
  }
}
