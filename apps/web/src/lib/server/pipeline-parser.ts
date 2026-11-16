import type { PipelineItem, PipelineParser } from './aados-store';

const money = (text: string) => text.match(/(?:\$|USD\s*)(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/i)?.[1]?.replaceAll(',', '') || '';
const date = (text: string) => text.match(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})\b/)?.[1] || '';

export function parseMessage(parser: PipelineParser, input: Pick<PipelineItem, 'subject' | 'sender' | 'summary'> & { body?: string }) {
  const text = `${input.subject}\n${input.sender}\n${input.summary}\n${input.body || ''}`;
  if (parser === 'shop') {
    const order = text.match(/(?:order|confirmation|receipt)\s*(?:#|number|no\.?|:)\s*([A-Z0-9-]{4,})/i)?.[1] || '';
    const tracking = text.match(/(?:tracking|shipment)\s*(?:#|number|no\.?|:)\s*([A-Z0-9-]{8,})/i)?.[1] || '';
    const kind = /refund|returned?/i.test(text) ? 'return' : /shipped|tracking|delivery/i.test(text) ? 'shipment' : /receipt|order|confirmation/i.test(text) ? 'purchase' : 'message';
    return { kind, facts: { order, tracking, amount: money(text), date: date(text) } };
  }
  if (parser === 'health') {
    const kind = /appointment|scheduled|visit/i.test(text) ? 'appointment' : /claim|EOB|explanation of benefits/i.test(text) ? 'claim' : /prescription|pharmacy|medication/i.test(text) ? 'prescription' : /invoice|bill|balance|payment/i.test(text) ? 'bill' : 'message';
    return { kind, facts: { provider: input.sender, amount: money(text), date: date(text) } };
  }
  return { kind: 'message', facts: { date: date(text), amount: money(text) } };
}
