/**
 * Direct Graph /sendMail send from the browser.
 *
 * The dashboard composer originally built mailto: links and handed off to
 * Outlook, which stripped HTML and dropped our CID-inlined logo. This module
 * gives the composer a real "Send" path: it acquires a Mail.Send scoped
 * access token via MSAL, attaches the branded wordmark PNG as a CID inline
 * attachment, and POSTs to graph.microsoft.com/.../sendMail.
 *
 * The shared mailbox path (/users/RealHack@realpage.com/sendMail) is used
 * when sendAs is provided — the signed-in user must hold Send-As permission
 * on that mailbox at the Exchange layer. Falling back to /me/sendMail when
 * sendAs is null sends the email as the signed-in user themselves.
 */
import { getGraphSendToken } from './auth';

export const REALHACK_SEND_AS = 'RealHack@realpage.com';
export const LOGO_CID = 'realhack-logo';

let _logoBase64Cache: string | null = null;

/**
 * Load the wordmark PNG once and cache the base64 representation.
 * The PNG itself lives in /public/realhack-logo.png so any deployed
 * copy of the SPA can fetch it from the same origin.
 *
 * Returns null if the fetch fails — sender then sends the HTML without
 * the attachment and the <img src="cid:realhack-logo"> tag renders as
 * alt-text rather than blowing up the whole send.
 */
async function loadLogoBase64(): Promise<string | null> {
  if (_logoBase64Cache !== null) return _logoBase64Cache;
  try {
    const r = await fetch('/realhack-logo.png');
    if (!r.ok) return null;
    const blob = await r.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
    // dataUrl looks like "data:image/png;base64,iVBORw0K..." — strip the prefix
    const idx = dataUrl.indexOf(',');
    if (idx < 0) return null;
    _logoBase64Cache = dataUrl.slice(idx + 1);
    return _logoBase64Cache;
  } catch {
    return null;
  }
}

export interface GraphSendOpts {
  subject: string;
  /** HTML body (preferred when set). */
  bodyHtml?: string | null;
  /** Plain-text body. Used when bodyHtml is empty/null. */
  bodyText: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** Shared mailbox to send AS. If null, sends from /me. */
  sendAs?: string | null;
  /** Optional Reply-To override. */
  replyTo?: string[];
}

interface GraphAddress {
  emailAddress: { address: string };
}

const toAddrs = (emails: string[] | undefined): GraphAddress[] =>
  (emails ?? []).filter((e) => !!e).map((address) => ({ emailAddress: { address } }));

/**
 * Send one email via Graph. Throws on non-2xx responses with the response
 * body included in the error message for diagnostic purposes.
 */
export async function sendEmailViaGraph(opts: GraphSendOpts): Promise<void> {
  const token = await getGraphSendToken();
  const useHtml = !!opts.bodyHtml;
  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: {
      contentType: useHtml ? 'HTML' : 'Text',
      content: useHtml ? opts.bodyHtml : opts.bodyText,
    },
    toRecipients: toAddrs(opts.to),
  };
  if (opts.cc && opts.cc.length) message.ccRecipients = toAddrs(opts.cc);
  if (opts.bcc && opts.bcc.length) message.bccRecipients = toAddrs(opts.bcc);
  if (opts.replyTo && opts.replyTo.length) message.replyTo = toAddrs(opts.replyTo);

  if (useHtml) {
    const logoB64 = await loadLogoBase64();
    if (logoB64) {
      message.attachments = [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'realhack-logo.png',
          contentType: 'image/png',
          contentId: LOGO_CID,
          isInline: true,
          contentBytes: logoB64,
        },
      ];
    }
  }

  const url = opts.sendAs
    ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.sendAs)}/sendMail`
    : 'https://graph.microsoft.com/v1.0/me/sendMail';

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  // Graph returns 202 Accepted on a successful queue, sometimes 200/204
  if (r.status >= 200 && r.status < 300) return;

  let detail = '';
  try {
    const j = await r.json();
    detail = j?.error?.message ?? JSON.stringify(j).slice(0, 300);
  } catch {
    detail = (await r.text().catch(() => '')).slice(0, 300);
  }
  throw new Error(`Graph /sendMail failed (${r.status}): ${detail}`);
}
