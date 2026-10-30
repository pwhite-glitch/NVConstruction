const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—'
const fmtNum = n => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'

// signedUrls: { [storagePath]: signedUrl }
export function buildMaintenanceReportHtml(report, signedUrls = {}) {
  const photos = (report.photos || [])
  const photoHtml = photos.length
    ? `<div class="photos">
        ${photos.map(p => {
          const url = signedUrls[p.path] || signedUrls[p] || ''
          return url
            ? `<div class="photo-wrap"><img src="${esc(url)}" alt="${esc(p.caption || '')}" /></div>`
            : ''
        }).join('')}
      </div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Maintenance Report — ${esc(report.equipment_name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111;background:#fff;padding:32px 40px;font-size:13px}
  .letterhead{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:3px solid #111;margin-bottom:24px}
  .company{font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#111}
  .llc{font-size:13px;font-weight:500;color:#555;margin-top:3px}
  .doc-label{text-align:right}
  .doc-label .title{font-size:18px;font-weight:800;color:#111}
  .doc-label .number{font-size:11px;color:#888;margin-top:4px}
  .section{margin-bottom:20px}
  .section-title{font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#888;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:12px}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .field label{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:3px}
  .field .val{font-size:14px;color:#111;font-weight:600}
  .description{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px;font-size:13px;color:#111;line-height:1.7;white-space:pre-wrap;margin-top:4px}
  .photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:8px}
  .photo-wrap{border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;aspect-ratio:4/3;background:#f3f4f6}
  .photo-wrap img{width:100%;height:100%;object-fit:cover;display:block}
  .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:12px}
  .sig-block{border-top:1px solid #111;padding-top:6px;font-size:11px;color:#555}
  .footer{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
  @media print{
    body{padding:0;font-size:12px}
    @page{margin:.7cm;size:letter portrait}
  }
</style></head><body>

<div class="letterhead">
  <div>
    <div class="company">JaxEm Fabrication LLC</div>
    <div class="llc">Equipment Maintenance Services</div>
  </div>
  <div class="doc-label">
    <div class="title">Maintenance Report</div>
    <div class="number">Date: ${esc(fmtDate(report.report_date))}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Equipment Details</div>
  <div class="fields">
    <div class="field"><label>Equipment</label><div class="val">${esc(report.equipment_name)}</div></div>
    <div class="field"><label>Hours at Service</label><div class="val">${esc(fmtNum(report.current_hours))} hrs</div></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Work Performed</div>
  <div class="description">${esc(report.description)}</div>
</div>

${photos.length ? `<div class="section">
  <div class="section-title">Photos (${photos.length})</div>
  ${photoHtml}
</div>` : ''}

<div class="section">
  <div class="section-title">Signatures</div>
  <div class="sig-row">
    <div class="sig-block">Technician: Landon Moore &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
    <div class="sig-block">Authorized By &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
  </div>
</div>

<div class="footer">
  <span>JaxEm Fabrication LLC · Equipment Maintenance Report</span>
  <span>Printed ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
</div>

<script>window.onload = () => window.print()</script>
</body></html>`
}

export function openMaintenanceReportPrint(report, signedUrls) {
  const w = window.open('', '_blank')
  if (w) { w.document.write(buildMaintenanceReportHtml(report, signedUrls)); w.document.close() }
}
