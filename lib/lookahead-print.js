// Printable 2-week lookahead (Download PDF), shared by the job page and the field app.
import { lookaheadDays, activitiesForDay, activitiesInDays, rangeLabel, dayOfRange } from './lookahead-dates'
import { responsibleLabel, hasOpenConstraint, statusInfo, stageLabel } from './lookahead-fields'
import { forecastText, isRainRisk, rainFlagged } from './lookahead-weather'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (s, opts) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
const workers = acts => acts.reduce((s, a) => s + (parseInt(a.manpower) || 0) + (a.additional_companies || []).reduce((s2, co) => s2 + (parseInt(co.manpower) || 0), 0), 0)

export function buildLookaheadPrintHtml({ job, lookahead, weekStart, activities, contracts, forecast = {} }) {
  const jobName = job?.project_name || job?.name || job?.address || 'Project'
  const jobNum = job?.job_number ? ` #${job.job_number}` : ''
  const days = lookaheadDays(weekStart)
  const dateRange = fmt(days[0], { month: 'short', day: 'numeric' }) + ' – ' + fmt(days[9], { month: 'short', day: 'numeric', year: 'numeric' })
  const todayStr = new Date().toISOString().split('T')[0]

  const renderActivity = (act, day) => {
    const type = act.responsible_type === 'sub' ? 'sub' : act.responsible_type === 'other' ? 'other' : 'own'
    const mp = parseInt(act.manpower) || 0
    const st = statusInfo(act.status)
    const range = dayOfRange(act, day)
    const matStatus = act.materials_status === 'on_site' ? '' : act.materials_status === 'ordered' ? '<span class="tag tag-warn">Materials: Ordered</span>' : '<span class="tag tag-alert">Materials: Need to Order</span>'
    return '<div class="activity act-' + type + (act.status === 'done' ? ' done' : '') + '">' +
      '<div class="act-title">' + esc(act.description) + (act.location ? '<span class="act-loc"> · ' + esc(act.location) + '</span>' : '') + '</div>' +
      '<div class="act-meta"><span class="tag tag-' + type + '">' + esc(responsibleLabel(act, contracts)) + '</span>' +
      '<span class="tag" style="color:' + st.fg + ';background:' + st.bg + ';border-color:' + st.bd + '">' + st.label + '</span>' +
      (range ? '<span class="tag">' + range + '</span>' : '') +
      (rainFlagged(act, forecast[day]) ? '<span class="tag tag-alert">☔ Rain risk</span>' : '') +
      (mp > 0 ? '<span class="tag">' + mp + ' workers</span>' : '') +
      (act.equipment ? '<span>⚙ ' + esc(act.equipment) + '</span>' : '') +
      (act.inspection_required ? '<span class="tag tag-warn">🔍 Inspection' + (act.inspection_scheduled ? ' ✓ Sched' : ' — Not Sched') + '</span>' : '') +
      (act.committed ? '<span class="tag tag-green">Committed ✓</span>' : '') +
      (act.preceding_work_complete ? '<span class="tag tag-green">Preceding ✓</span>' : '') +
      matStatus +
      (act.additional_companies || []).map(co => '<span class="tag tag-other">+' + esc(co.name) + (co.manpower ? ' (' + co.manpower + ')' : '') + '</span>').join('') +
      '</div>' +
      (act.constraints ? '<div class="act-constraint">⛔ ' + esc(act.constraints) + '</div>' : '') +
      (act.constraints_notes ? '<div class="act-notes">' + esc(act.constraints_notes) + '</div>' : '') +
      '</div>'
  }

  const renderWeek = (wkDays, wkNum) => {
    const wkActs = activitiesInDays(activities, wkDays)
    const totalManpower = workers(wkActs)
    const inspections = wkActs.filter(a => a.inspection_required).length
    const open = wkActs.filter(hasOpenConstraint).length
    return '<div class="week"><div class="week-header"><span class="week-title">Week ' + wkNum + ' — ' + fmt(wkDays[0], { month: 'short', day: 'numeric' }) + ' – ' + fmt(wkDays[4], { month: 'short', day: 'numeric' }) + '</span><span class="week-stats">' +
      (totalManpower > 0 ? '<span>' + totalManpower + ' workers total</span>' : '') +
      (inspections > 0 ? '<span class="warn">⚠ ' + inspections + ' inspection' + (inspections > 1 ? 's' : '') + '</span>' : '') +
      (open > 0 ? '<span class="alert">⛔ ' + open + ' open constraint' + (open > 1 ? 's' : '') + '</span>' : '') +
      (wkActs.length > 0 ? '<span>' + wkActs.length + ' activities</span>' : '') + '</span></div>' +
      wkDays.map(day => {
        const dayActs = activitiesForDay(activities, day)
        const w = forecast[day]
        const isToday = day === todayStr
        return '<div class="day' + (isToday ? ' today' : '') + '"><div class="day-header"><span class="day-name">' + fmt(day, { weekday: 'long' }) + ' <span class="day-date">' + fmt(day, { month: 'short', day: 'numeric' }) + (isToday ? ' · TODAY' : '') + '</span></span>' +
          (w ? '<span class="wx">' + esc((w.icon ? w.icon + ' ' : '') + w.label + ' · ' + forecastText(w)) + (isRainRisk(w) ? ' <strong class="alert">Rain risk</strong>' : '') + '</span>' : '') +
          '</div>' +
          (dayActs.length === 0 ? '<div class="empty">No activities</div>' : dayActs.map(a => renderActivity(a, day)).join('')) +
          '</div>'
      }).join('') + '</div>'
  }

  const multiDay = activities.filter(a => rangeLabel(a))
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>2-Week Lookahead — ${esc(jobName)}${esc(jobNum)}</title><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;margin:0;padding:36px;font-size:13px}
    h1{font-size:22px;font-weight:800;margin:0 0 2px}h2{font-size:13px;font-weight:400;color:#666;margin:0 0 28px}
    .week{margin-bottom:32px}
    .week-header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px;flex-wrap:wrap;gap:6px}
    .week-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#111}
    .week-stats{display:flex;gap:12px;font-size:11px;color:#666;align-items:center}
    .warn{color:#b45309}.alert{color:#991b1b}
    .day{margin-bottom:12px}
    .day-header{margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
    .day-name{font-size:13px;font-weight:700;color:#111}
    .day-date{font-size:11px;font-weight:400;color:#888}
    .wx{font-size:11px;color:#555}
    .today .day-name{color:#e8590c}
    .activity{border:1px solid #e5e7eb;border-radius:6px;padding:9px 12px;margin-bottom:6px;background:#fff;page-break-inside:avoid}
    .activity.done .act-title{text-decoration:line-through;color:#6b7280}
    .act-own{border-left:3px solid #22c55e}.act-sub{border-left:3px solid #38bdf8}.act-other{border-left:3px solid #fb923c}
    .act-title{font-size:13px;font-weight:600;margin-bottom:5px;line-height:1.3}
    .act-loc{font-weight:400;color:#888;font-size:12px}
    .act-meta{display:flex;flex-wrap:wrap;gap:5px;font-size:11px;color:#555;align-items:center;margin-bottom:3px}
    .tag{padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700;border:1px solid #e5e7eb;background:#f9fafb}
    .tag-own{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}
    .tag-sub{background:#f0f9ff;color:#0369a1;border-color:#bae6fd}
    .tag-other{background:#fff7ed;color:#c2410c;border-color:#fed7aa}
    .tag-warn{background:#fffbeb;color:#b45309;border-color:#fde68a}
    .tag-alert{background:#fef2f2;color:#991b1b;border-color:#fecaca}
    .tag-green{background:#f0fdf4;color:#15803d;border-color:#bbf7d0}
    .act-constraint{font-size:11px;color:#991b1b;margin-top:5px;padding-top:5px;border-top:1px solid #fecaca;font-style:italic}
    .act-notes{font-size:11px;color:#4b5563;margin-top:5px;font-style:italic}
    .empty{font-size:12px;color:#d1d5db;padding:2px 0 6px}
    .multi{font-size:11px;color:#555;margin:-18px 0 24px}
    @media print{body{padding:18px}@page{margin:1.5cm;size:letter portrait}}
  </style></head><body>
  <h1>2-Week Lookahead${jobNum ? ' — ' + esc(jobNum) : ''}</h1>
  <h2>${esc(jobName)} · ${dateRange} · ${esc(stageLabel(lookahead))}</h2>
  ${multiDay.length ? '<div class="multi">Multi-day: ' + multiDay.map(a => esc(a.description) + ' (' + rangeLabel(a) + ')').join(' · ') + '</div>' : ''}
  ${renderWeek(days.slice(0, 5), 1)}
  ${renderWeek(days.slice(5, 10), 2)}
  <script>window.onload=()=>window.print()</script></body></html>`
}

export function openLookaheadPrint(args) {
  const w = window.open('', '_blank')
  if (w) { w.document.write(buildLookaheadPrintHtml(args)); w.document.close() }
}
