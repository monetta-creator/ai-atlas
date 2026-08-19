import { exec, withTx } from '../db';

// ---- Tickets — the public feedback box (migration 0032) ---------------------
// createTicket is the ONE public write path in this module: it is called by the
// allow-listed POST /api/tickets route after validation (length caps, email
// shape, image count/size/magic bytes, honeypot). Everything else is admin.

export async function createTicket(input: {
  kind: 'bug' | 'feature';
  title: string;
  body: string;
  email: string;
  severity: string | null;
  page: string | null;
  userAgent: string | null;
  images: { contentType: string; bytes: Buffer }[];
}): Promise<string> {
  return withTx(async (c) => {
    const row = await c.query(
      `insert into tickets (kind, title, body, email, severity, page, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [input.kind, input.title, input.body, input.email, input.severity, input.page, input.userAgent]
    );
    const id = row.rows[0].id as string;
    for (const img of input.images) {
      await c.query(
        `insert into ticket_images (ticket_id, content_type, bytes) values ($1, $2, $3)`,
        [id, img.contentType, img.bytes]
      );
    }
    return id;
  });
}

export async function setTicketStatus(id: string, status: 'open' | 'in_progress' | 'resolved' | 'declined'): Promise<void> {
  await exec(
    `update tickets set status = $2::ticket_status_t,
            resolved_at = case when $2 in ('resolved', 'declined') then now() else null end
      where id = $1`,
    [id, status]
  );
}

export async function setTicketAdminNote(id: string, note: string | null): Promise<void> {
  await exec(`update tickets set admin_note = $2 where id = $1`, [id, note]);
}

export async function deleteTicket(id: string): Promise<void> {
  await exec(`delete from tickets where id = $1`, [id]);
}
