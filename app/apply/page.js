'use client'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const TRADES = [
  'Concrete', 'Masonry', 'Structural Steel', 'Carpentry / Framing',
  'Roofing', 'Drywall', 'Painting', 'Flooring', 'Doors & Windows',
  'Mechanical / HVAC', 'Electrical', 'Plumbing', 'Fire Protection',
  'Site Work / Grading', 'Landscaping', 'Insulation', 'Waterproofing',
  'Signage', 'Cleaning', 'Other'
]

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', padding: '2rem 1rem' },
  container: { maxWidth: '640px', margin: '0 auto' },
  logo: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' },
  logoImg: { width: '80px', height: '80px', objectFit: 'contain', marginBottom: '12px' },
  logoText: { fontSize: '11px', fontWeight: '600', letterSpacing: '4px', color: '#666', textTransform: 'uppercase' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '16px', padding: '2rem' },
  cardTitle: { fontSize: '20px', fontWeight: '800', color: '#f1f1f1', margin: '0 0 4px' },
  cardSub: { fontSize: '13px', color: '#555', margin: '0 0 2rem' },
  sectionTitle: { fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '1.5rem 0 1rem', paddingBottom: '8px', borderBottom: '1px solid #1e1e1e' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  textarea: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none', resize: 'vertical', minHeight: '80px' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  uploadBox: { border: '1px dashed #2a2a2a', borderRadius: '8px', padding: '20px', textAlign: 'center', cursor: 'pointer', background: '#0a0a0a' },
  uploadLabel: { fontSize: '13px', color: '#555' },
  uploadSuccess: { fontSize: '13px', color: '#4ade80' },
  btn: { width: '100%', padding: '13px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '1.5rem' },
  success: { background: '#0a1a0a', border: '1px solid #1a4a1a', borderRadius: '16px', padding: '3rem', textAlign: 'center' },
  successTitle: { fontSize: '20px', fontWeight: '800', color: '#4ade80', margin: '0 0 8px' },
  successSub: { fontSize: '14px', color: '#555', margin: 0 },
  err: { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' },
  required: { color: '#e8590c', marginLeft: '2px' },
}

export default function Apply() {
  const [form, setForm] = useState({
    company_name: '', contact_name: '', email: '', phone: '', address: '',
    trade: '', scope_description: '', coi_expiration: '', license_number: ''
  })
  const [w9File, setW9File] = useState(null)
  const [coiFile, setCoiFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))

  async function uploadFile(file, path) {
    const { data, error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (error) throw error
    return data.path
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      let w9_url = null
      let coi_url = null

      if (w9File) {
        const path = `w9/${Date.now()}_${w9File.name}`
        w9_url = await uploadFile(w9File, path)
      }

      if (coiFile) {
        const path = `coi/${Date.now()}_${coiFile.name}`
        coi_url = await uploadFile(coiFile, path)
      }

      const { error } = await supabase.from('sub_directory').insert({
        company_name: form.company_name,
        contact_name: form.contact_name,
        email: form.email.toLowerCase().trim(),
        phone: form.phone,
        address: form.address,
        trade: form.trade,
        scope_description: form.scope_description,
        coi_expiration: form.coi_expiration || null,
        license_number: form.license_number,
        w9_url,
        coi_url,
      })

      if (error) throw error
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.logo}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
          </div>
          <div style={s.success}>
            <div style={s.successTitle}>Application submitted!</div>
            <div style={s.successSub}>Thank you for applying to NV Construction's subcontractor network. We'll review your application and be in touch.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.logo}>
          <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
          <span style={s.logoText}>Subcontractor application</span>
        </div>

        <div style={s.card}>
          <h1 style={s.cardTitle}>Apply to our network</h1>
          <p style={s.cardSub}>Complete this form to be added to NV Construction's subcontractor directory. We'll review your application and reach out.</p>

          {error && <div style={s.err}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div style={s.sectionTitle}>Company info</div>
            <div style={{ ...s.grid2, marginBottom: '12px' }}>
              <div><label style={s.label}>Company name<span style={s.required}>*</span></label><input style={s.input} value={form.company_name} onChange={e => update('company_name', e.target.value)} required placeholder="ABC Concrete Co." /></div>
              <div><label style={s.label}>Contact name<span style={s.required}>*</span></label><input style={s.input} value={form.contact_name} onChange={e => update('contact_name', e.target.value)} required placeholder="John Smith" /></div>
            </div>
            <div style={{ ...s.grid2, marginBottom: '12px' }}>
              <div><label style={s.label}>Email<span style={s.required}>*</span></label><input type="email" style={s.input} value={form.email} onChange={e => update('email', e.target.value)} required placeholder="you@company.com" /></div>
              <div><label style={s.label}>Phone</label><input style={s.input} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="(555) 555-5555" /></div>
            </div>
            <div style={{ marginBottom: '12px' }}><label style={s.label}>Address</label><input style={s.input} value={form.address} onChange={e => update('address', e.target.value)} placeholder="123 Main St, City, TX 75001" /></div>

            <div style={s.sectionTitle}>Trade & scope</div>
            <div style={{ marginBottom: '12px' }}>
              <label style={s.label}>Primary trade<span style={s.required}>*</span></label>
              <select style={s.input} value={form.trade} onChange={e => update('trade', e.target.value)} required>
                <option value="">Select your trade...</option>
                {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={s.label}>Scope description</label>
              <textarea style={s.textarea} value={form.scope_description} onChange={e => update('scope_description', e.target.value)} placeholder="Describe your services, specialties, and typical project types..." />
            </div>

            <div style={s.sectionTitle}>Documents & compliance</div>
            <div style={{ ...s.grid2, marginBottom: '12px' }}>
              <div>
                <label style={s.label}>W-9</label>
                <div style={s.uploadBox} onClick={() => document.getElementById('w9-upload').click()}>
                  <div style={w9File ? s.uploadSuccess : s.uploadLabel}>{w9File ? '✓ ' + w9File.name : 'Click to upload W-9'}</div>
                  <input id="w9-upload" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setW9File(e.target.files[0])} />
                </div>
              </div>
              <div>
                <label style={s.label}>Certificate of insurance</label>
                <div style={s.uploadBox} onClick={() => document.getElementById('coi-upload').click()}>
                  <div style={coiFile ? s.uploadSuccess : s.uploadLabel}>{coiFile ? '✓ ' + coiFile.name : 'Click to upload COI'}</div>
                  <input id="coi-upload" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setCoiFile(e.target.files[0])} />
                </div>
              </div>
            </div>
            <div style={{ ...s.grid2, marginBottom: '1.5rem' }}>
              <div><label style={s.label}>COI expiration date</label><input type="date" style={s.input} value={form.coi_expiration} onChange={e => update('coi_expiration', e.target.value)} /></div>
              <div><label style={s.label}>License number</label><input style={s.input} value={form.license_number} onChange={e => update('license_number', e.target.value)} placeholder="TX-12345" /></div>
            </div>

            <button type="submit" style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
              {loading ? 'Submitting...' : 'Submit application'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
