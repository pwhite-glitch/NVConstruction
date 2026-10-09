'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

const STAGE_LABELS = {
  lead: 'In Review',
  quoted: 'Quote Sent',
  contract_signed: 'Contract Signed',
  order_placed: 'Order Placed',
  scheduled: 'Scheduled',
  installed: 'Installation Complete',
  completed: 'Completed',
  on_hold: 'On Hold',
}

const STAGE_COLORS = {
  lead: { bg: '#f3f4f6', color: '#374151' },
  quoted: { bg: '#eff6ff', color: '#1d4ed8' },
  contract_signed: { bg: '#f0fdf4', color: '#15803d' },
  order_placed: { bg: '#fef3c7', color: '#b45309' },
  scheduled: { bg: '#fef3c7', color: '#b45309' },
  installed: { bg: '#ecfdf5', color: '#065f46' },
  completed: { bg: '#ecfdf5', color: '#065f46' },
  on_hold: { bg: '#fff7ed', color: '#c2410c' },
}

const DIVISION_LABELS = {
  metal_buildings: 'Metal Building',
  commercial_roofing: 'Commercial Roofing',
  residential_roofing: 'Residential Roofing',
  solar: 'Solar',
  other: 'Other',
}

const DOC_CATEGORY_LABELS = {
  contract: 'Contract',
  invoice: 'Invoice',
  permit: 'Permit',
  drawing: 'Drawing',
  spec: 'Specification',
  warranty: 'Warranty',
  other: 'Document',
}

function fmt(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function fmtDateTime(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

const s = {
  page: {
    minHeight: '100vh',
    background: '#f4f6f8',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#111827',
  },
  header: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '0 20px',
  },
  headerInner: {
    maxWidth: '760px',
    margin: '0 auto',
    padding: '18px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  logo: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '800',
    color: '#111827',
    letterSpacing: '-0.3px',
  },
  logoAccent: {
    color: '#e8590c',
  },
  headerSub: {
    margin: 0,
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: '500',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  container: {
    maxWidth: '760px',
    margin: '0 auto',
    padding: '28px 20px 60px',
  },
  greeting: {
    margin: '0 0 24px',
    fontSize: '22px',
    fontWeight: '700',
    color: '#111827',
  },
  greetingSub: {
    margin: '-18px 0 24px',
    fontSize: '14px',
    color: '#6b7280',
  },
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '16px',
  },
  cardTitle: {
    margin: '0 0 16px',
    fontSize: '13px',
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  rowLabel: {
    fontSize: '13px',
    color: '#6b7280',
    minWidth: '160px',
    flexShrink: 0,
    paddingTop: '1px',
  },
  rowValue: {
    fontSize: '14px',
    color: '#111827',
    fontWeight: '500',
    flex: 1,
  },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #f3f4f6',
    margin: '16px 0',
  },
  timelineItem: {
    display: 'flex',
    gap: '16px',
    paddingBottom: '20px',
    position: 'relative',
  },
  timelineDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: '#e8590c',
    flexShrink: 0,
    marginTop: '5px',
    position: 'relative',
    zIndex: 1,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: '4px',
  },
  timelineDate: {
    fontSize: '12px',
    color: '#9ca3af',
    marginBottom: '4px',
  },
  timelineBody: {
    fontSize: '14px',
    color: '#111827',
    lineHeight: '1.6',
    margin: 0,
  },
  timelineAuthor: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
  },
  docRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  docName: {
    flex: 1,
    fontSize: '14px',
    color: '#111827',
    fontWeight: '500',
  },
  docMeta: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  downloadBtn: {
    padding: '6px 14px',
    background: 'transparent',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#374151',
    cursor: 'pointer',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '12px 14px',
    fontSize: '14px',
    color: '#111827',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    resize: 'vertical',
    outline: 'none',
    lineHeight: '1.5',
    minHeight: '100px',
  },
  sendBtn: {
    marginTop: '12px',
    padding: '11px 24px',
    background: '#e8590c',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },
  sendBtnDisabled: {
    marginTop: '12px',
    padding: '11px 24px',
    background: '#d1d5db',
    color: '#9ca3af',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'not-allowed',
  },
  successMsg: {
    padding: '14px 16px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#15803d',
    marginTop: '12px',
  },
  errorMsg: {
    padding: '14px 16px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#b91c1c',
    marginTop: '12px',
  },
  noteText: {
    margin: '10px 0 0',
    fontSize: '12px',
    color: '#9ca3af',
  },
  emptyText: {
    fontSize: '14px',
    color: '#9ca3af',
    fontStyle: 'italic',
    margin: 0,
  },
  dateNote: {
    fontSize: '12px',
    color: '#9ca3af',
    fontStyle: 'italic',
    marginLeft: '6px',
  },
}

function StageBadge({ stage }) {
  const label = STAGE_LABELS[stage] || stage
  const colors = STAGE_COLORS[stage] || { bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ ...s.badge, background: colors.bg, color: colors.color }}>
      {label}
    </span>
  )
}

function DocCategoryBadge({ category }) {
  const label = DOC_CATEGORY_LABELS[category] || category
  return (
    <span style={{
      ...s.badge,
      background: '#eff6ff',
      color: '#1d4ed8',
      fontSize: '11px',
      padding: '2px 8px',
    }}>
      {label}
    </span>
  )
}

function DateRow({ label, confirmed, expected }) {
  const hasConfirmed = !!confirmed
  const hasExpected = !!expected

  let value
  if (hasConfirmed) {
    value = <span style={s.rowValue}>{fmt(confirmed)}</span>
  } else if (hasExpected) {
    value = (
      <span style={s.rowValue}>
        {fmt(expected)}
        <span style={s.dateNote}>(estimated)</span>
      </span>
    )
  } else {
    value = <span style={{ ...s.rowValue, color: '#9ca3af', fontWeight: 400 }}>To be confirmed</span>
  }

  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      {value}
    </div>
  )
}

export default function CustomerPortalPage() {
  const { token } = useParams()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState(null)

  const [downloadingDoc, setDownloadingDoc] = useState(null)

  useEffect(() => {
    if (!token) {
      setInvalid(true)
      setLoading(false)
      return
    }
    async function load() {
      try {
        const res = await fetch(`/api/customer-portal?token=${encodeURIComponent(token)}`)
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setInvalid(true)
          setLoading(false)
          return
        }
        if (!res.ok) {
          setFetchError('Unable to load your order. Please try again or contact us.')
          setLoading(false)
          return
        }
        const json = await res.json()
        if (!json.order) {
          setInvalid(true)
          setLoading(false)
          return
        }
        setData(json)
      } catch (e) {
        setFetchError('Unable to load your order. Please try again or contact us.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  const handleDownload = useCallback(async (doc) => {
    if (downloadingDoc === doc.id) return
    setDownloadingDoc(doc.id)
    try {
      const res = await fetch(
        `/api/customer-portal?token=${encodeURIComponent(token)}&doc_url=${encodeURIComponent(doc.storage_path || doc.file_name)}`
      )
      if (!res.ok) {
        alert('Unable to download this file. Please contact your project team.')
        return
      }
      const json = await res.json()
      if (json.url) {
        window.open(json.url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      alert('Download failed. Please try again.')
    } finally {
      setDownloadingDoc(null)
    }
  }, [token, downloadingDoc])

  const handleSendQuestion = useCallback(async (e) => {
    e.preventDefault()
    if (!question.trim() || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/customer-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_question',
          token,
          access_id: data?.access_id,
          body: question.trim(),
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setSendError(json.error || 'Failed to send your question. Please try again.')
        return
      }
      setQuestion('')
      setSent(true)
    } catch {
      setSendError('Failed to send your question. Please try again.')
    } finally {
      setSending(false)
    }
  }, [question, sending, token, data])

  // Loading state
  if (loading) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerInner}>
            <div style={s.headerLeft}>
              <p style={s.logo}>
                <span style={s.logoAccent}>NV</span> Construction
              </p>
              <p style={s.headerSub}>Order Portal</p>
            </div>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '80px' }}>
          <p style={{ color: '#9ca3af', fontSize: '15px' }}>Loading your order...</p>
        </div>
      </div>
    )
  }

  // Invalid / revoked token
  if (invalid) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerInner}>
            <div style={s.headerLeft}>
              <p style={s.logo}>
                <span style={s.logoAccent}>NV</span> Construction
              </p>
              <p style={s.headerSub}>Order Portal</p>
            </div>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '72px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '64px', height: '64px', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: '50%',
            fontSize: '28px', marginBottom: '20px', color: '#b91c1c',
          }}>
            &#10005;
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#111827', margin: '0 0 10px' }}>
            This link is no longer valid
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', maxWidth: '380px', margin: '0 auto 28px', lineHeight: '1.6' }}>
            This portal link may have expired or been revoked. Please contact your NV Construction project team for a new link.
          </p>
          <div style={{
            display: 'inline-block',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '16px 24px',
            fontSize: '14px',
            color: '#374151',
          }}>
            <strong>NV Construction</strong><br />
            <a href="mailto:info@nvim.co" style={{ color: '#e8590c', textDecoration: 'none' }}>info@nvim.co</a>
          </div>
        </div>
      </div>
    )
  }

  // General fetch error
  if (fetchError) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerInner}>
            <div style={s.headerLeft}>
              <p style={s.logo}>
                <span style={s.logoAccent}>NV</span> Construction
              </p>
              <p style={s.headerSub}>Order Portal</p>
            </div>
          </div>
        </div>
        <div style={{ ...s.container, textAlign: 'center', paddingTop: '72px' }}>
          <p style={{ color: '#b91c1c', fontSize: '15px', marginBottom: '12px' }}>{fetchError}</p>
          <p style={{ color: '#6b7280', fontSize: '13px' }}>
            Contact us at{' '}
            <a href="mailto:info@nvim.co" style={{ color: '#e8590c' }}>info@nvim.co</a>
          </p>
        </div>
      </div>
    )
  }

  const { order, docs = [], updates = [], customer_name } = data

  const divisionLabel = DIVISION_LABELS[order.division] || order.division || 'Construction'

  const sortedUpdates = [...updates].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const visibleDocs = docs // API should already filter; render all returned

  // Building dimensions (metal buildings)
  const isMetalBuilding = order.division === 'metal_buildings'
  const products = order.products || []
  const options = order.options || []

  // Try to extract dimensions from products or order fields
  const buildingProduct = products.find(p =>
    p.width || p.length || p.height || p.eave_height
  ) || null

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.headerLeft}>
            <p style={s.logo}>
              <span style={s.logoAccent}>NV</span> Construction
            </p>
            <p style={s.headerSub}>Order Portal</p>
          </div>
          <StageBadge stage={order.stage} />
        </div>
      </div>

      <div style={s.container}>
        {/* Greeting */}
        <h1 style={s.greeting}>
          Hello, {customer_name || order.customer_name}
        </h1>
        <p style={{ ...s.greetingSub, marginTop: '-18px', marginBottom: '24px' }}>
          Here&apos;s the latest on your {divisionLabel} project.
        </p>

        {/* Order Summary */}
        <div style={s.card}>
          <p style={s.cardTitle}>Order Summary</p>

          <div style={s.row}>
            <span style={s.rowLabel}>Order Number</span>
            <span style={{ ...s.rowValue, fontWeight: '700', fontSize: '15px' }}>{order.order_number}</span>
          </div>

          <div style={s.row}>
            <span style={s.rowLabel}>Status</span>
            <StageBadge stage={order.stage} />
          </div>

          {order.site_address && (
            <div style={s.row}>
              <span style={s.rowLabel}>Site Address</span>
              <span style={s.rowValue}>{order.site_address}</span>
            </div>
          )}

          {(order.customer_company) && (
            <div style={s.row}>
              <span style={s.rowLabel}>Company</span>
              <span style={s.rowValue}>{order.customer_company}</span>
            </div>
          )}

          <div style={s.row}>
            <span style={s.rowLabel}>Division</span>
            <span style={s.rowValue}>{divisionLabel}</span>
          </div>

          {isMetalBuilding && buildingProduct && (
            <div style={s.row}>
              <span style={s.rowLabel}>Building Size</span>
              <span style={s.rowValue}>
                {[
                  buildingProduct.width ? `${buildingProduct.width}’W` : null,
                  buildingProduct.length ? `${buildingProduct.length}’L` : null,
                  (buildingProduct.height || buildingProduct.eave_height)
                    ? `${buildingProduct.height || buildingProduct.eave_height}’H`
                    : null,
                ].filter(Boolean).join(' × ') || 'See contract'}
              </span>
            </div>
          )}

          {order.scope_description && (
            <>
              <hr style={s.divider} />
              <div style={s.row}>
                <span style={s.rowLabel}>Scope</span>
                <span style={{ ...s.rowValue, lineHeight: '1.6', fontWeight: 400 }}>{order.scope_description}</span>
              </div>
            </>
          )}

          <hr style={s.divider} />

          {order.salesperson_name && (
            <div style={s.row}>
              <span style={s.rowLabel}>Your Sales Rep</span>
              <span style={s.rowValue}>{order.salesperson_name}</span>
            </div>
          )}

          {order.ops_owner_name && (
            <div style={s.row}>
              <span style={s.rowLabel}>Project Manager</span>
              <span style={s.rowValue}>{order.ops_owner_name}</span>
            </div>
          )}
        </div>

        {/* Key Dates */}
        <div style={s.card}>
          <p style={s.cardTitle}>Key Dates</p>

          {order.contract_signed_at && (
            <div style={s.row}>
              <span style={s.rowLabel}>Contract Signed</span>
              <span style={s.rowValue}>{fmt(order.contract_signed_at)}</span>
            </div>
          )}

          <DateRow
            label="Expected Delivery"
            confirmed={order.confirmed_delivery_date}
            expected={order.expected_delivery_date}
          />

          <DateRow
            label="Expected Installation"
            confirmed={order.confirmed_install_date}
            expected={order.expected_install_date}
          />
        </div>

        {/* Documents */}
        <div style={s.card}>
          <p style={s.cardTitle}>Documents</p>
          {visibleDocs.length === 0 ? (
            <p style={s.emptyText}>No documents shared yet.</p>
          ) : (
            <div>
              {visibleDocs.map((doc, idx) => (
                <div
                  key={doc.id || idx}
                  style={{
                    ...s.docRow,
                    borderBottom: idx === visibleDocs.length - 1 ? 'none' : '1px solid #f3f4f6',
                    paddingTop: idx === 0 ? '0' : '12px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                      <span style={s.docName}>{doc.file_name}</span>
                      <DocCategoryBadge category={doc.category} />
                    </div>
                    {doc.created_at && (
                      <span style={s.docMeta}>Uploaded {fmtDateTime(doc.created_at)}</span>
                    )}
                  </div>
                  <button
                    style={downloadingDoc === doc.id ? { ...s.downloadBtn, opacity: 0.6, cursor: 'default' } : s.downloadBtn}
                    onClick={() => handleDownload(doc)}
                    disabled={downloadingDoc === doc.id}
                  >
                    {downloadingDoc === doc.id ? 'Loading...' : 'Download'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Updates / Progress */}
        <div style={s.card}>
          <p style={s.cardTitle}>Project Updates</p>
          {sortedUpdates.length === 0 ? (
            <p style={s.emptyText}>No updates yet. Check back soon.</p>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Timeline line */}
              {sortedUpdates.length > 1 && (
                <div style={{
                  position: 'absolute',
                  left: '4px',
                  top: '5px',
                  bottom: '24px',
                  width: '2px',
                  background: '#f3f4f6',
                }} />
              )}
              {sortedUpdates.map((update, idx) => (
                <div key={update.id || idx} style={s.timelineItem}>
                  <div style={s.timelineDot} />
                  <div style={s.timelineContent}>
                    <p style={s.timelineDate}>{fmtDateTime(update.created_at)}</p>
                    <p style={s.timelineBody}>{update.body}</p>
                    {update.author_name && (
                      <p style={s.timelineAuthor}>— {update.author_name}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Questions / Contact */}
        <div style={s.card}>
          <p style={s.cardTitle}>Send a Question</p>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 16px', lineHeight: '1.6' }}>
            Have a question about your project? Send it here and your project team will follow up.
          </p>
          {sent ? (
            <div style={s.successMsg}>
              Your question has been sent. We&apos;ll follow up soon.
            </div>
          ) : (
            <form onSubmit={handleSendQuestion}>
              <textarea
                style={s.textarea}
                placeholder="Type your question here..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                rows={4}
                maxLength={2000}
              />
              {sendError && (
                <div style={s.errorMsg}>{sendError}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  style={question.trim() && !sending ? s.sendBtn : s.sendBtnDisabled}
                  disabled={!question.trim() || sending}
                >
                  {sending ? 'Sending...' : 'Send Question'}
                </button>
                <p style={{ ...s.noteText, margin: 0, fontSize: '12px', color: '#9ca3af' }}>
                  Questions are reviewed by your project team.
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: '12px', color: '#d1d5db', marginTop: '32px' }}>
          &copy; {new Date().getFullYear()} NV Construction &mdash; This portal is private to your account.
        </p>
      </div>
    </div>
  )
}
