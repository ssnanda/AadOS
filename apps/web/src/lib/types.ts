export type EmailAccount = {
  id: string;
  provider: 'gmail' | 'microsoft';
  address: string;
  status: 'connected' | 'error' | 'disconnected';
};

export type EmailCounts = {
  all: number;
  unread: number;
  needs_reply: number;
  important: number;
};

export type Overview = {
  connection_state: 'not_connected' | 'connected' | 'error';
  read_only: boolean;
  accounts: EmailAccount[];
  counts: EmailCounts;
  features: { gmail: boolean; microsoft: boolean; ai_triage: boolean };
};

export type MailMessage = {
  id: string;
  account_id: string;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  category: string;
  unread: boolean;
  needs_reply: boolean;
  important: boolean;
};

export type MailboxData = {
  overview: Overview;
  messages: MailMessage[];
  apiStatus: 'online' | 'offline';
};
