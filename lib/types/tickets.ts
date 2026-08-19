// ---- Tickets — the public feedback box (migration 0032) ---------------------
// Bug reports and feature requests filed from the rail dialogs. `email` is an
// admin-only column: readers must never surface it on a public payload.
export type TicketKind = 'bug' | 'feature';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'declined';

export interface Ticket {
  id: string;
  kind: TicketKind;
  status: TicketStatus;
  title: string;
  body: string;
  email: string;
  severity: string | null;         // bugs only: cosmetic / annoying / blocking
  page: string | null;             // the path the dialog was opened from
  user_agent: string | null;
  admin_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  image_ids: string[];             // joined-in for the admin list
}
