'use client'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const TRADES = [
  'Concrete', 'Masonry', 'Structural Steel', 'Carpentry / Framing',
  'Roofing', 'Drywall', 'Painting', 'Flooring', 'Doors & Windows',
  'Mechanical / HVAC', 'Electrical', 'Plumbing', 'Fire Protection',
  'Site Work / Grading', 'Landscaping', 'Insulation', 'Waterproofing',
  'Signage', 'Cleaning', 'Other',
]

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', padding: '2rem 1rem' },
  container: { maxWidth: '600px', margin: '0 auto' },
  logo: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' },
  logoImg: { width: '72px', height: '72px', objectFit: 'contain', marginBottom: '10px' },
  logoText: { fontSize: '11px', fontWeight: '600', letterSpacing: '4px', color: '#555', textTransform: 'uppercase' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '16px', padding: '2rem' },
  stepTitle: { fontSize: '20px', fontWeight: '800', color: '#f1f1f1', margin: '0 0 4px' },
  stepSub: { fontSize: '13px', color: '#555', margin: '0 0 1.75rem', lineHeight: 1.5 },
  sectionLabel: { fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '2px', textTransform: 'uppercase', margin: '1.5rem 0 0.75rem', paddingBottom: '6px', borderBottom: '1px solid #1a1a1a' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  textarea: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none', resize: 'vertical', minHeight: '80px' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  btn: { width: '100%', padding: '13px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '1.5rem' },
  btnGray: { width: '100%', padding: '13px', background: 'transparent', color: '#555', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  err: { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '1rem' },
  required: { color: '#e8590c', marginLeft: '2px' },
  uploadBox: { border: '1px dashed #2a2a2a', borderRadius: '8px', padding: '18px', textAlign: 'center', cursor: 'pointer', background: '#0a0a0a' },
  successPage: { textAlign: 'center', background: '#0d1a0d', border: '1px solid #1a3a1a', borderRadius: '16px', padding: '3rem 2rem' },
}

function StepIndicator({ step }) {
  const steps = ['Company', 'Account', 'Documents']
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.75rem', gap: 0 }}>
      {steps.map((label, i) => {
        const num = i + 1
        const active = num === step
        const done = num < step
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: '800',
                background: done ? '#1a3a1a' : active ? '#e8590c' : '#1a1a1a',
                color: done ? '#4ade80' : active ? '#fff' : '#333',
                border: `2px solid ${done ? '#2a5a2a' : active ? '#e8590c' : '#2a2a2a'}`,
              }}>{done ? '✓' : num}</div>
              <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', color: active ? '#f1f1f1' : done ? '#4ade80' : '#333' }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: '60px', height: '2px', background: done ? '#2a5a2a' : '#1a1a1a', margin: '0 4px', marginBottom: '18px' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Apply() {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const [company, setCompany] = useState({ company_name: '', trade: '', phone: '', address: '', scope_description: '' })
  const [account, setAccount] = useState({ full_name: '', email: '', password: '', confirm: '' })
  const [docs, setDocs] = useState({ coi_expiration: '', license_number: '' })
  const [w9File, setW9File] = useState(null)
  const [coiFile, setCoiFile] = useState(null)

  const setC = (k, v) => setCompany(f => ({ ...f, [k]: v }))
  const setA = (k, v) => setAccount(f => ({ ...f, [k]: v }))
  const setD = (k, v) => setDocs(f => ({ ...f, [k]: v }))

  function goNext() {
    setError('')
    if (step === 1) {
      if (!company.company_name.trim()) return setError('Company name is required.')
      if (!company.trade) return setError('Please select your primary trade.')
    }
    if (step === 2) {
      if (!account.full_name.trim()) return setError('Your name is required.')
      if (!account.email.trim() || !account.email.includes('@')) return setError('A valid email is required.')
      if (account.password.length < 6) return setError('Password must be at least 6 characters.')
      if (account.password !== account.confirm) return setError('Passwords do not match.')
    }
    setStep(s => s + 1)
  }

  async function handleSubmit() {
    setLoading(true)
    setError('')
    try {
      let w9_url = null, coi_url = null
      if (w9File) {
        const { data, error } = await supabase.storage.from('documents').upload(`w9/${Date.now()}_${w9File.name}`, w9File, { upsert: true })
        if (error) throw error
        w9_url = data.path
      }
      if (coiFile) {
        const { data, error } = await supabase.storage.from('documents').upload(`coi/${Date.now()}_${coiFile.name}`, coiFile, { upsert: true })
        if (error) throw error
        coi_url = data.path
      }

      const email = account.email.toLowerCase().trim()

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: account.password,
        options: { data: { full_name: account.full_name.trim(), role: 'subcontractor' } },
      })
      if (authError) throw authError

      const { error: dirError } = await supabase.from('sub_directory').insert({
        company_name: company.company_name.trim(),
        contact_name: account.full_name.trim(),
        email,
        phone: company.phone || null,
        address: company.address || null,
        trade: company.trade,
        scope_description: company.scope_description || null,
        coi_expiration: docs.coi_expiration || null,
        license_number: docs.license_number || null,
        w9_url,
        coi_url,
        status: 'approved',
      })
      if (dirError) throw dirError

      if (authData.user) {
        await supabase.from('profiles').update({
          company_name: company.company_name.trim(),
          phone: company.phone || null,
        }).eq('id', authData.user.id)
      }

      setDone(true)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div style={s.page}>
        <div style={s.container}>
          <div style={s.logo}><img src="/logo.png" alt="NV Construction" style={s.logoImg} /></div>
          <div style={s.successPage}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>✓</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: '#4ade80', marginBottom: '8px' }}>Application submitted!</div>
            <div style={{ fontSize: '14px', color: '#555', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Thank you, {account.full_name.split(' ')[0]}. We'll review your application and notify you once you're approved.<br />
              You can log in at any time to check your status or upload documents.
            </div>
            <a href="/login" style={{ display: 'inline-block', padding: '12px 28px', background: '#e8590c', color: '#fff', textDecoration: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '14px', letterSpacing: '1px' }}>Go to Login</a>
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
          <span style={s.logoText}>Subcontractor registration</span>
        </div>

        <StepIndicator step={step} />

        <div style={s.card}>
          {error && <div style={s.err}>{error}</div>}

          {/* ── Step 1: Company ─────────────────────────────── */}
          {step === 1 && (
            <>
              <h2 style={s.stepTitle}>Company information</h2>
              <p style={s.stepSub}>Tell us about your company. You'll create your login account on the next step.</p>

              <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                <div>
                  <label style={s.label}>Company name<span style={s.required}>*</span></label>
                  <input style={s.input} value={company.company_name} onChange={e => setC('company_name', e.target.value)} placeholder="ABC Concrete Co." />
                </div>
                <div>
                  <label style={s.label}>Phone</label>
                  <input style={s.input} value={company.phone} onChange={e => setC('phone', e.target.value)} placeholder="(555) 555-5555" />
                </div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={s.label}>Primary trade<span style={s.required}>*</span></label>
                <select style={s.input} value={company.trade} onChange={e => setC('trade', e.target.value)}>
                  <option value="">Select your trade...</option>
                  {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={s.label}>Address</label>
                <input style={s.input} value={company.address} onChange={e => setC('address', e.target.value)} placeholder="123 Main St, City, TX 75001" />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={s.label}>Scope / services description</label>
                <textarea style={s.textarea} value={company.scope_description} onChange={e => setC('scope_description', e.target.value)} placeholder="Describe your services, specialties, and typical project types..." />
              </div>
              <button style={s.btn} onClick={goNext}>Next — Create account →</button>
            </>
          )}

          {/* ── Step 2: Account ──────────────────────────────── */}
          {step === 2 && (
            <>
              <h2 style={s.stepTitle}>Create your account</h2>
              <p style={s.stepSub}>You'll use this to log in, view plans, submit bids, and manage billing. <strong style={{ color: '#f1f1f1' }}>Required — we need at least one person with a login for every company.</strong></p>

              <div style={{ marginBottom: '12px' }}>
                <label style={s.label}>Your full name<span style={s.required}>*</span></label>
                <input style={s.input} value={account.full_name} onChange={e => setA('full_name', e.target.value)} placeholder="John Smith" />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={s.label}>Email<span style={s.required}>*</span></label>
                <input type="email" style={s.input} value={account.email} onChange={e => setA('email', e.target.value)} placeholder="john@company.com" />
              </div>
              <div style={{ ...s.grid2, marginBottom: '1.5rem' }} className="rx-grid-2">
                <div>
                  <label style={s.label}>Password<span style={s.required}>*</span></label>
                  <input type="password" style={s.input} value={account.password} onChange={e => setA('password', e.target.value)} placeholder="Min. 6 characters" />
                </div>
                <div>
                  <label style={s.label}>Confirm password<span style={s.required}>*</span></label>
                  <input type="password" style={s.input} value={account.confirm} onChange={e => setA('confirm', e.target.value)} placeholder="Repeat password" />
                </div>
              </div>
              <button style={s.btn} onClick={goNext}>Next — Upload documents →</button>
              <button style={s.btnGray} onClick={() => setStep(1)}>← Back</button>
            </>
          )}

          {/* ── Step 3: Documents ────────────────────────────── */}
          {step === 3 && (
            <>
              <h2 style={s.stepTitle}>Documents</h2>
              <p style={s.stepSub}>Upload your W-9 and certificate of insurance if you have them ready. You can also add these later after logging in.</p>

              <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                <div>
                  <label style={s.label}>W-9</label>
                  <div style={s.uploadBox} onClick={() => document.getElementById('w9-upload').click()}>
                    <div style={{ fontSize: '13px', color: w9File ? '#4ade80' : '#444' }}>{w9File ? '✓ ' + w9File.name : 'Click to upload W-9'}</div>
                    <input id="w9-upload" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setW9File(e.target.files[0] || null)} />
                  </div>
                </div>
                <div>
                  <label style={s.label}>Certificate of insurance</label>
                  <div style={s.uploadBox} onClick={() => document.getElementById('coi-upload').click()}>
                    <div style={{ fontSize: '13px', color: coiFile ? '#4ade80' : '#444' }}>{coiFile ? '✓ ' + coiFile.name : 'Click to upload COI'}</div>
                    <input id="coi-upload" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setCoiFile(e.target.files[0] || null)} />
                  </div>
                </div>
              </div>
              <div style={{ ...s.grid2, marginBottom: '1.5rem' }} className="rx-grid-2">
                <div>
                  <label style={s.label}>COI expiration date</label>
                  <input type="date" style={s.input} value={docs.coi_expiration} onChange={e => setD('coi_expiration', e.target.value)} />
                </div>
                <div>
                  <label style={s.label}>License number</label>
                  <input style={s.input} value={docs.license_number} onChange={e => setD('license_number', e.target.value)} placeholder="TX-12345" />
                </div>
              </div>
              <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={handleSubmit}>
                {loading ? 'Submitting...' : 'Submit application'}
              </button>
              <button style={{ ...s.btnGray, opacity: loading ? 0.4 : 1 }} disabled={loading} onClick={handleSubmit}>
                Skip documents — submit now
              </button>
              <button style={{ ...s.btnGray, marginTop: '4px', opacity: loading ? 0.4 : 1 }} disabled={loading} onClick={() => setStep(2)}>← Back</button>
            </>
          )}
        </div>

        {step === 1 && (
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#333', marginTop: '1rem' }}>
            Already have an account? <a href="/login" style={{ color: '#e8590c', fontWeight: '600', textDecoration: 'none' }}>Sign in</a>
          </p>
        )}
      </div>
    </div>
  )
}
