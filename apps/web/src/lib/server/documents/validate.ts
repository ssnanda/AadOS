// Upload validation by content signature (magic bytes), never by the client's filename or Content-Type. Pure.
import { createHash } from 'node:crypto';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const TYPES = {
  'application/pdf': { label: 'PDF', ext: 'pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'Word', ext: 'docx' },
  'text/plain': { label: 'Text', ext: 'txt' },
  'image/jpeg': { label: 'JPEG', ext: 'jpg' },
  'image/png': { label: 'PNG', ext: 'png' }
} as const;
export type Mime = keyof typeof TYPES;

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
/** Does a ZIP's central directory list `name`? (DOCX = ZIP containing word/document.xml.) */
export function zipHas(b: Uint8Array, name: string): boolean {
  const needle = Buffer.from(name);
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return buf.indexOf(needle) !== -1 && startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
}
function isText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
}

export function sniff(b: Uint8Array): Mime | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (zipHas(b, 'word/document.xml')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (b.length && isText(b)) return 'text/plain';
  return null;
}

/** Display filename only (never used as a storage key): no paths, no control/reserved characters, sensible length. */
export function safeFilename(name: string, mime: Mime): string {
  const base = String(name || '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const ext = TYPES[mime].ext;
  if (!base) return `document.${ext}`;
  return new RegExp(`\\.${ext === 'jpg' ? 'jpe?g' : ext}$`, 'i').test(base) ? base : `${base}.${ext}`;
}

export type Checked = { ok: true; mime: Mime; filename: string; size: number; checksum: string } | { ok: false; error: string };
export function checkUpload(bytes: Uint8Array, filename: string): Checked {
  if (!bytes.byteLength) return { ok: false, error: 'The file is empty.' };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  const mime = sniff(bytes);
  if (!mime) return { ok: false, error: 'Unsupported file type. Allowed: PDF, DOCX, TXT, JPG, PNG.' };
  return { ok: true, mime, filename: safeFilename(filename, mime), size: bytes.byteLength, checksum: createHash('sha256').update(bytes).digest('hex') };
}

/** Content-Disposition with an ASCII fallback and RFC 5987 UTF-8 name (no header injection). */
export const contentDisposition = (filename: string, inline = false) => `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
