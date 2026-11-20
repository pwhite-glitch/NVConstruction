'use client'
import React from 'react'
import { PO_PAYER_LABELS } from '../../lib/po-invoices'

// Who pays this PO's vendor (prompt 99, migration 082). Blank = follow the job's
// "Who pays vendors (POs)" setting; NV / Owner = an explicit exception for this PO only.
export default function POPayerSelector({ value, onChange, name, jobPayer }) {
  const opts = [
    { val: '', label: `Follow job (${jobPayer === 'owner' ? 'Owner pays' : 'NV pays'})` },
    { val: 'nv', label: 'NV pays — this PO only' },
    { val: 'owner', label: 'Owner pays — this PO only' },
  ]
  const cur = value || ''
  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {opts.map(o => (
          <label key={o.val || 'job'} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '6px', border: cur === o.val ? '1px solid #e8590c' : '1px solid #d1d5db', background: cur === o.val ? '#fff7ed' : '#ffffff', cursor: 'pointer', fontSize: '13px', color: cur === o.val ? '#111827' : '#6b7280', userSelect: 'none' }}>
            <input type="radio" name={name} value={o.val} checked={cur === o.val} onChange={() => onChange(o.val)} style={{ accentColor: '#e8590c' }} />
            {o.label}
          </label>
        ))}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>
        Job setting: {PO_PAYER_LABELS[jobPayer] || PO_PAYER_LABELS.nv}. NV-paid POs go on the office Ready to pay list once a PM approves the invoice; owner-paid POs are tracked only.
      </p>
    </div>
  )
}
