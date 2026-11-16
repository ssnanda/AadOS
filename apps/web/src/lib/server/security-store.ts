// Small durable security state: session revocation cut-off and login-failure counters.
// Survives restarts; file is 0600 and written atomically. Pure Node (no framework imports) for unit tests.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Data = { validAfter: number; failures: Record<string, number[]> };

export class SecurityStore {
  private dir: string;
  private file: string;
  constructor(dir: string) { this.dir = dir; this.file = join(dir, 'security.json'); }

  private read(): Data {
    try { const d = JSON.parse(readFileSync(this.file, 'utf8')); return { validAfter: Number(d.validAfter) || 0, failures: d.failures && typeof d.failures === 'object' ? d.failures : {} }; }
    catch { return { validAfter: 0, failures: {} }; }
  }
  private write(data: Data) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, this.file);
  }

  /** Sessions issued before this time (ms) are rejected. */
  validAfter(): number { return this.read().validAfter; }
  revokeAllSessions(now = Date.now()) { const d = this.read(); d.validAfter = now; this.write(d); }

  recentFailures(key: string, windowMs: number, now = Date.now()): number { return (this.read().failures[key] || []).filter((t) => now - t < windowMs).length; }
  addFailure(key: string, windowMs: number, now = Date.now()) {
    const d = this.read();
    for (const k of Object.keys(d.failures)) { d.failures[k] = d.failures[k].filter((t) => now - t < windowMs); if (!d.failures[k].length) delete d.failures[k]; }
    (d.failures[key] ||= []).push(now); this.write(d);
  }
  clearFailures(key: string) { const d = this.read(); if (d.failures[key]) { delete d.failures[key]; this.write(d); } }
}
