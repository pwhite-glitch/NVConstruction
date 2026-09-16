'use client'
import React from 'react'
import PaymentTypeSelector from './PaymentTypeSelector'

export default function EditPOForm({ s, fmt, po, editPOForm, setEditPOForm, editPOFile, setEditPOFile, budgetItems, savingPOEdit, savePOEdit, setEditingPOId }) {
  return (
    <div style={{ padding: '14px 0' }}>
      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '1rem' }}>Edit {po.po_number}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label style={s.label}>Vendor *</label>
          <input style={s.input} value={editPOForm.vendor_name} onChange={e => setEditPOForm(f => ({ ...f, vendor_name: e.target.value }))} />
        </div>
        <div>
          <label style={s.label}>Description</label>
          <input style={s.input} value={editPOForm.description} onChange={e => setEditPOForm(f => ({ ...f, description: e.target.value }))} />
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={s.label}>Payment type</label>
        <PaymentTypeSelector name="po_pt_edit" value={editPOForm.payment_type} onChange={v => setEditPOForm(f => ({ ...f, payment_type: v }))} />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={s.label}>Budget line item</label>
        <select style={s.input} value={editPOForm.budget_item_id} onChange={e => setEditPOForm(f => ({ ...f, budget_item_id: e.target.value }))}>
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
            {editPOForm.items.map((item, idx) => (
              <div key={item.uid} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 110px 36px', gap: '0 4px', borderBottom: idx < editPOForm.items.length - 1 ? '1px solid #111' : 'none', alignItems: 'center' }}>
                <input style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', borderRight: '1px solid #111' }} placeholder="Item description" value={item.description}
                  onChange={e => setEditPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, description: e.target.value } : x) }))} />
                <input type="number" min="0" max={100000} step="0.01" style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', textAlign: 'right', borderRight: '1px solid #111' }} value={item.qty}
                  onChange={e => setEditPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x) }))} />
                <input style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', borderRight: '1px solid #111' }} placeholder="ea" value={item.unit}
                  onChange={e => setEditPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x) }))} />
                <input type="number" min="0" step="0.01" style={{ ...s.input, border: 'none', borderRadius: 0, background: 'transparent', textAlign: 'right', borderRight: '1px solid #111' }} placeholder="0.00" value={item.unit_price}
                  onChange={e => setEditPOForm(f => ({ ...f, items: f.items.map((x, i) => i === idx ? { ...x, unit_price: e.target.value } : x) }))} />
                <button onClick={() => setEditPOForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '16px', padding: 0, textAlign: 'center' }}>&times;</button>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 110px 36px', gap: '0 4px', padding: '8px 10px', background: '#111', borderTop: '2px solid #1e1e1e' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#555', gridColumn: '1/4', textAlign: 'right' }}>Total:</span>
              <span style={{ textAlign: 'right', fontWeight: '800', color: '#e8590c', fontFamily: 'monospace', fontSize: '14px' }}>{fmt(editPOForm.items.reduce((a, i) => a + (parseFloat(i.qty) || 1) * (parseFloat(i.unit_price) || 0), 0))}</span>
              <span />
            </div>
          </div>
          <button type="button" style={{ marginTop: '8px', fontSize: '12px', color: '#e8590c', background: 'none', border: '1px dashed #3a1a00', borderRadius: '6px', padding: '5px 14px', cursor: 'pointer' }}
            onClick={() => setEditPOForm(f => ({ ...f, items: [...f.items, { uid: Date.now(), description: '', qty: '1', unit: '', unit_price: '' }] }))}>
            + Add item
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={s.label}>Notes</label>
        <textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={editPOForm.notes} onChange={e => setEditPOForm(f => ({ ...f, notes: e.target.value }))} />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={s.label}>Replace attachment</label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '7px 14px', background: '#0a0a0a', border: '1px dashed #2a2a2a', borderRadius: '6px', fontSize: '12px', color: editPOFile ? '#f1f1f1' : '#555' }}>
          {editPOFile ? editPOFile.name : '+ Attach file (PDF, image, etc.)'}
          <input type="file" style={{ display: 'none' }} accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={e => setEditPOFile(e.target.files[0] || null)} />
        </label>
        {editPOFile && <button onClick={() => setEditPOFile(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px' }}>Remove</button>}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button style={{ ...s.btnSmall, opacity: savingPOEdit ? 0.6 : 1 }} disabled={savingPOEdit} onClick={savePOEdit}>{savingPOEdit ? 'Saving...' : 'Save changes'}</button>
        <button style={s.btnGray} onClick={() => setEditingPOId(null)}>Cancel</button>
      </div>
    </div>
  )
}
