'use client'
import React from 'react'
import PaymentTypeSelector from './PaymentTypeSelector'

export default function NewPOForm({ s, poForm, setPOForm, poFile, setPOFile, budgetItems, savingPO, savePO }) {
  const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={s.label}>Vendor / Supplier *</label>
          <input style={s.input} value={poForm.vendor_name} onChange={e => setPOForm(f => ({ ...f, vendor_name: e.target.value }))} placeholder="Vendor name" />
        </div>
        <div>
          <label style={s.label}>Description</label>
          <input style={s.input} value={poForm.description} onChange={e => setPOForm(f => ({ ...f, description: e.target.value }))} placeholder="What is this PO for?" />
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={s.label}>Payment type</label>
        <PaymentTypeSelector name="po_pt_new" value={poForm.payment_type} onChange={v => setPOForm(f => ({ ...f, payment_type: v }))} />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={s.label}>Budget line item</label>
        <select style={s.input} value={poForm.budget_item_id} onChange={e => setPOForm(f => ({ ...f, budget_item_id: e.target.value }))}>
          <option value="">&mdash; Unassigned &mdash;</option>
          {budgetItems.map(b => (
            <option key={b.id} value={b.id}>{b.cost_code ? b.cost_code + ' · ' : ''}{b.description}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={s.label}>Line items</label>
        <div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 110px 36px', gap: '0 4px', padding: '7px 10px', borderBottom: '1px solid #1e1e1e', fontSize: '10px', fontWeight: '700', color: '#444', letterSpacing: '1px', textTransform: 'uppercase' }}>
              <span>Description</span>
              <span style={{ textAlign: 'right' }}>Qty</span>
              <span>Unit</span>
              <span style={{ textAlign: 'right' }}>Unit Price</span>
              <span />
            </div>
            {poForm.items.map((item, idx) => (
              <div key={item.uid} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 110px 36px', gap: '0 4px', borderBottom: idx < poForm.items.length - 1 ? '1px solid #111' : 'none', alignItems: 'center' }}>
                <input style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', borderRight: '1px solid #111' }} placeholder="Item description" value={item.description}
                  onChange={e => setPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, description: e.target.value } : x) }))} />
                <input type="number" min="0" max={100000} step="0.01" style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', textAlign: 'right', borderRight: '1px solid #111' }} value={item.qty}
                  onChange={e => setPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x) }))} />
                <input style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', borderRight: '1px solid #111' }} placeholder="ea" value={item.unit}
                  onChange={e => setPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x) }))} />
                <input type="number" min="0" step="0.01" style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', textAlign: 'right', borderRight: '1px solid #111' }} placeholder="0.00" value={item.unit_price}
                  onChange={e => setPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, unit_price: e.target.value } : x) }))} />
                <button onClick={() => setPOForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '16px', padding: 0, textAlign: 'center' }}>&times;</button>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 110px 36px', gap: '0 4px', padding: '8px 10px', background: '#111', borderTop: '2px solid #1e1e1e' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#555', gridColumn: '1/4', textAlign: 'right' }}>Total:</span>
              <span style={{ textAlign: 'right', fontWeight: '800', color: '#e8590c', fontFamily: 'monospace', fontSize: '14px' }}>{fmt(poForm.items.reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0))}</span>
              <span />
            </div>
          </div>
          <button type="button" style={{ marginTop: '8px', fontSize: '12px', color: '#e8590c', background: 'none', border: '1px dashed #3a1a00', borderRadius: '6px', padding: '5px 14px', cursor: 'pointer' }}
            onClick={() => setPOForm(f => ({ ...f, items: [...f.items, { uid: Date.now(), description: '', qty: '1', unit: '', unit_price: '' }] }))}>
            + Add item
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label style={s.label}>Notes</label>
        <textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={poForm.notes} onChange={e => setPOForm(f => ({ ...f, notes: e.target.value }))} placeholder="Delivery instructions, payment terms..." />
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label style={s.label}>Attachment {!poFile && <span style={{ color: '#888', fontWeight: 'normal' }}>(required to issue)</span>}</label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '7px 14px', background: '#0a0a0a', border: poFile ? '1px solid #3a1a00' : '1px dashed #2a2a2a', borderRadius: '6px', fontSize: '12px', color: poFile ? '#f1f1f1' : '#555' }}>
          {poFile ? poFile.name : '+ Attach file (PDF, image, etc.)'}
          <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={e => setPOFile(e.target.files[0] || null)} />
        </label>
        {poFile && <button onClick={() => setPOFile(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px' }}>Remove</button>}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button style={{ ...s.btnSmallGreen, padding: '8px 20px', opacity: (savingPO || !poForm.vendor_name || !poFile) ? 0.6 : 1 }} disabled={savingPO || !poForm.vendor_name || !poFile} title={!poFile ? 'Attach a document before issuing' : ''} onClick={() => savePO(true)}>
          {savingPO ? 'Saving...' : 'Issue PO'}
        </button>
        <button style={{ ...s.btnSmall, padding: '8px 20px', opacity: (savingPO || !poForm.vendor_name) ? 0.6 : 1 }} disabled={savingPO || !poForm.vendor_name} onClick={() => savePO(false)}>
          Save as Draft
        </button>
      </div>
    </div>
  )
}
