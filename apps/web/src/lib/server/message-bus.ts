// In-process fan-out of BlueBubbles webhook events to open Messages pages (Server-Sent Events). One web pod, so an
// EventEmitter is enough; a page that misses an event catches up on its next load.
import { EventEmitter } from 'node:events';
declare global { var __aadosMsgBus: EventEmitter | undefined; }
export const messageBus = (): EventEmitter => { if (!globalThis.__aadosMsgBus) { globalThis.__aadosMsgBus = new EventEmitter(); globalThis.__aadosMsgBus.setMaxListeners(100); } return globalThis.__aadosMsgBus; };
export type BusEvent = { type: string; chatGuid: string; message?: import('$lib/messages-model').Message };
