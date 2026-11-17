// Small durable security state: session revocation cut-off and login-failure counters.
// Survives restarts; file is 0600 and written atomically. Pure Node (no framework imports) for unit tests.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** passwordHash: owner password changed in Settings; base = fingerprint of the deployment hash it replaced (a reset of
 *  the deployment login, e.g. `dev-local.sh --reset-user`, changes that hash and so makes the override inactive). */
type Data = { validAfter: number; failures: Record<string, number[]>; passwordHash?: string; passwordBase?: string; members?: Member[] };

/** Sections a family member can be allowed into (Settings is always owner-only). */
export const PERMISSIONS = ['emails', 'calendar', 'tasks', 'reminders', 'asana', 'documents', 'assistant'] as const;
export type Permission = (typeof PERMISSIONS)[number];
/** A family login. `mailboxes`: account ids they may read ('all' = every mailbox). `ver` bumps on password change/disable,
 *  ending that member's sessions. */
export type Member = { id: string; name: string; username: string; passwordHash: string; permissions: Permission[]; mailboxes: string[] | 'all'; ver: number; disabled?: boolean; createdAt: string };

export class SecurityStore {
  private dir: string;
  private file: string;
  constructor(dir: string) { this.dir = dir; this.file = join(dir, 'security.json'); }

  private read(): Data {
    try { const d = JSON.parse(readFileSync(this.file, 'utf8')); return { members: Array.isArray(d.members) ? d.members : [], validAfter: Number(d.validAfter) || 0, failures: d.failures && typeof d.failures === 'object' ? d.failures : {}, ...(typeof d.passwordHash === 'string' ? { passwordHash: d.passwordHash, passwordBase: String(d.passwordBase || '') } : {}) }; }
    catch { return { validAfter: 0, failures: {}, members: [] }; }
  }
  private write(data: Data) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, this.file);
  }

  /** The owner's password hash: a Settings change wins only while the deployment hash it replaced is unchanged. */
  effectivePasswordHash(deploymentHash: string, fingerprint: (v: string) => string): string {
    const d = this.read();
    return d.passwordHash && d.passwordBase === fingerprint(deploymentHash) ? d.passwordHash : deploymentHash;
  }
  setPasswordHash(hash: string, deploymentHash: string, fingerprint: (v: string) => string) { const d = this.read(); d.passwordHash = hash; d.passwordBase = fingerprint(deploymentHash); this.write(d); }

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

  // ---- family members ----
  members(): Member[] { return this.read().members || []; }
  member(id: string): Member | undefined { return this.members().find((m) => m.id === id); }
  memberByUsername(username: string): Member | undefined { const u = username.trim().toLowerCase(); return this.members().find((m) => m.username.toLowerCase() === u); }
  saveMember(member: Member) { const d = this.read(); const list = d.members || []; const i = list.findIndex((m) => m.id === member.id); if (i >= 0) list[i] = member; else list.push(member); d.members = list; this.write(d); }
  removeMember(id: string) { const d = this.read(); d.members = (d.members || []).filter((m) => m.id !== id); this.write(d); }
}
