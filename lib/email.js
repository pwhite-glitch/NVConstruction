// Office staff only (/api/send-email checks the role). Sub-triggered emails are
// built and addressed server-side; see notifyBidSubmitted and /api/sub-portal/billing.
export async function sendEmail(to, subject, html) {
  if (!to) return
  try {
    await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    })
  } catch (_) {}
}

// Sub portal: tell the office a bid was submitted. The server looks up the
// caller's own submission and writes the email; the caller sets no content.
export async function notifyBidSubmitted(bidPackageId) {
  try {
    await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bid_submitted', bid_package_id: bidPackageId }),
    })
  } catch (_) {}
}

// For user-entered text placed in email HTML on the server.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function emailWrap(body) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#0a0a0a;padding:2rem;border-radius:12px;border:1px solid #222">
      <div style="margin-bottom:1.5rem">
        <span style="font-weight:800;font-size:15px;color:#e8590c;letter-spacing:2px;text-transform:uppercase">NV Construction</span>
      </div>
      ${body}
      <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #222;font-size:12px;color:#555">NV Construction · Sub Portal</div>
    </div>
  `
}

// "Billing is open" email sent when a PM turns billing on for a job AND ticks
// "Email these contacts". Used by the job page Companies tab and the dashboard job chips.
export function billingOpenEmail({ firstName, projectName, contractAmt }) {
  const portalUrl = (typeof window !== 'undefined' ? window.location.origin : 'https://nv-construction-doym.vercel.app') + '/submit'
  return {
    subject: `Billing is open: Set up your Schedule of Values — ${projectName || ''}`,
    html: emailWrap(`
      <h2 style="color:#f1f1f1;margin:0 0 8px;font-size:18px">Hey ${firstName || 'there'},</h2>
      <p style="color:#aaa;margin:0 0 16px;font-size:14px;line-height:1.6">
        Billing is now open for <strong style="color:#f1f1f1">${projectName || 'the project'}</strong>${contractAmt ? ` against your subcontract of <strong style="color:#e8590c">${contractAmt}</strong>` : ''}.
      </p>
      <p style="color:#aaa;margin:0 0 20px;font-size:14px;line-height:1.6">
        Before you can submit billing, you need to create your <strong style="color:#f1f1f1">Schedule of Values</strong> — a breakdown of your contract into line items that you'll bill against each period.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 24px">
        <tr>
          <td style="background:#e8590c;border-radius:8px">
            <a href="${portalUrl}" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase">Set Up My SOV</a>
          </td>
        </tr>
      </table>
      <p style="color:#555;font-size:12px;margin:0">Log in, select the project, and you'll be prompted to create your schedule before billing is available.</p>
    `),
  }
}
