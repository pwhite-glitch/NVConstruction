'use client'
import React from 'react'

export default function PaymentTypeSelector({ value, onChange, name }) {
  const opts = [
    { val: 'check', label: 'Check to vendor' },
    { val: 'reimbursement', label: 'Reimbursement' },
  ]
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {opts.map(o => (
        <label key={o.val} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '6px', border: value === o.val ? '1px solid #e8590c' : '1px solid #2a2a2a', background: value === o.val ? '#1a0800' : '#0a0a0a', cursor: 'pointer', fontSize: '13px', color: value === o.val ? '#f1f1f1' : '#888', userSelect: 'none' }}>
          <input type="radio" name={name} value={o.val} checked={value === o.val} onChange={() => onChange(o.val)} style={{ accentColor: '#e8590c' }} />
          {o.label}
        </label>
      ))}
    </div>
  )
}
