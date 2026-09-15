'use client'
import React from 'react'

export default function MeetingsTab({
  s,
  meetings,
  showNewMeeting, setShowNewMeeting,
  meetingForm, setMeetingForm,
  meetingTranscript, setMeetingTranscript,
  parsedMeeting, setParsedMeeting,
  parsingMeeting,
  savingMeeting,
  expandedMeetingId, setExpandedMeetingId,
  meetingMsg,
  parseMeetingTranscript,
  saveMeeting,
  toggleActionItem,
  deleteMeeting,
  addContactFromMeeting,
}) {
  const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <p style={s.cardTitle}>Meeting Minutes</p>
          <p style={{ fontSize: '13px', color: '#555', margin: 0 }}>Paste Plaud transcripts to extract action items, decisions, and contacts.</p>
        </div>
        {!showNewMeeting && (
          <button style={s.btnSmallOrange} onClick={() => { setShowNewMeeting(true); setParsedMeeting(null); setMeetingTranscript('') }}>+ New Meeting</button>
        )}
      </div>

      {meetingMsg && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: meetingMsg.ok ? '#0a2a0a' : '#2a0a0a', color: meetingMsg.ok ? '#4ade80' : '#ff6b6b', border: meetingMsg.ok ? '1px solid #1a4a1a' : '1px solid #5a1a1a' }}>
          {meetingMsg.text}
        </div>
      )}

      {showNewMeeting && (
        <div style={s.card}>
          <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New Meeting</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '1rem' }}>
            <div>
              <label style={s.label}>Date</label>
              <input type="date" style={s.input} value={meetingForm.meeting_date}
                onChange={e => setMeetingForm(f => ({ ...f, meeting_date: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Meeting Title</label>
              <input type="text" style={s.input} placeholder="e.g. Owner Design Meeting" value={meetingForm.title}
                onChange={e => setMeetingForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Attendees</label>
              <input type="text" style={s.input} placeholder="Names, comma-separated" value={meetingForm.attendees}
                onChange={e => setMeetingForm(f => ({ ...f, attendees: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={s.label}>Plaud Transcript / Meeting Notes</label>
            <textarea style={{ ...s.textarea, minHeight: '200px', fontFamily: 'monospace', fontSize: '13px' }}
              placeholder="Paste your Plaud meeting minutes or notes here..."
              value={meetingTranscript}
              onChange={e => setMeetingTranscript(e.target.value)} />
            <p style={{ fontSize: '11px', color: '#444', margin: '4px 0 0' }}>{meetingTranscript.length.toLocaleString()} characters</p>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: parsedMeeting ? '1.5rem' : 0 }}>
            {meetingTranscript.trim().length >= 20 && !parsedMeeting && (
              <button style={s.btn} onClick={parseMeetingTranscript} disabled={parsingMeeting}>
                {parsingMeeting ? 'Parsing…' : '✦ Parse with AI'}
              </button>
            )}
            <button style={s.btnGray} onClick={() => { setShowNewMeeting(false); setParsedMeeting(null); setMeetingTranscript('') }}>Cancel</button>
          </div>

          {parsedMeeting && (
            <div style={{ borderTop: '1px solid #222', paddingTop: '1.5rem' }}>
              <p style={{ fontSize: '12px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
                ✦ AI Extraction — Review Before Saving
              </p>

              {parsedMeeting.topics && parsedMeeting.topics.length > 0 && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <p style={s.label}>Topics Discussed</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {parsedMeeting.topics.map((t, i) => (
                      <span key={i} style={{ padding: '3px 10px', borderRadius: '99px', background: '#1a1a2a', color: '#818cf8', border: '1px solid #2a2a4a', fontSize: '12px' }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {parsedMeeting.action_items && parsedMeeting.action_items.length > 0 && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <p style={s.label}>Action Items ({parsedMeeting.action_items.length})</p>
                  {parsedMeeting.action_items.map((a, i) => (
                    <div key={i} style={{ ...s.inlineForm, marginBottom: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <input type="text" style={{ ...s.input, marginBottom: '6px' }} value={a.description}
                            onChange={e => setParsedMeeting(p => ({ ...p, action_items: p.action_items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input type="text" style={{ ...s.input, flex: 1 }} placeholder="Assigned to" value={a.assigned_to || ''}
                              onChange={e => setParsedMeeting(p => ({ ...p, action_items: p.action_items.map((x, j) => j === i ? { ...x, assigned_to: e.target.value } : x) }))} />
                            <input type="date" style={{ ...s.input, width: '150px' }} value={a.due_date || ''}
                              onChange={e => setParsedMeeting(p => ({ ...p, action_items: p.action_items.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x) }))} />
                          </div>
                        </div>
                        <button style={s.btnSmallRed} onClick={() => setParsedMeeting(p => ({ ...p, action_items: p.action_items.filter((_, j) => j !== i) }))}>&#x2715;</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {parsedMeeting.decisions && parsedMeeting.decisions.length > 0 && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <p style={s.label}>Decisions Made ({parsedMeeting.decisions.length})</p>
                  {parsedMeeting.decisions.map((d, i) => (
                    <div key={i} style={{ ...s.inlineForm, marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input type="text" style={{ ...s.input, flex: 1 }} value={d.description}
                        onChange={e => setParsedMeeting(p => ({ ...p, decisions: p.decisions.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                      <button style={s.btnSmallRed} onClick={() => setParsedMeeting(p => ({ ...p, decisions: p.decisions.filter((_, j) => j !== i) }))}>&#x2715;</button>
                    </div>
                  ))}
                </div>
              )}

              {parsedMeeting.contacts && parsedMeeting.contacts.length > 0 && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <p style={s.label}>Contacts Mentioned</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {parsedMeeting.contacts.map((c, i) => (
                      <div key={i} style={{ ...s.inlineForm, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ margin: '0 0 2px', fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{c.name}</p>
                          {c.company && <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>{c.company}</p>}
                          {c.role && <p style={{ margin: 0, fontSize: '11px', color: '#60a5fa' }}>{c.role}</p>}
                        </div>
                        <button style={s.btnSmallOrange}
                          onClick={() => addContactFromMeeting({ name: c.name, company: c.company || '', role: c.role || '', phone: c.phone || '', email: c.email || '', notes: '' })}>
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button style={s.btn} onClick={saveMeeting} disabled={savingMeeting}>
                {savingMeeting ? 'Saving…' : 'Save Meeting'}
              </button>
            </div>
          )}

          {!parsedMeeting && meetingTranscript.trim().length === 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button style={s.btn} onClick={saveMeeting} disabled={savingMeeting}>
                {savingMeeting ? 'Saving…' : 'Save Meeting (no transcript)'}
              </button>
            </div>
          )}
        </div>
      )}

      {meetings.length > 0 && (
        <div>
          {meetings.map(m => {
            const openItems = m.meeting_action_items ? m.meeting_action_items.filter(a => a.status === 'open') : []
            const isExpanded = expandedMeetingId === m.id
            return (
              <div key={m.id} style={s.contractRow}>
                <div style={{ ...s.contractRowHeader, cursor: 'pointer' }} onClick={() => setExpandedMeetingId(isExpanded ? null : m.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{m.title || 'Meeting'}</span>
                    <span style={{ fontSize: '13px', color: '#555' }}>{fmtDate(m.meeting_date)}</span>
                    {openItems.length > 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: '#2a1200', color: '#e8590c', border: '1px solid #4a2200' }}>{openItems.length} open</span>
                    )}
                    {m.meeting_action_items && m.meeting_action_items.length > 0 && openItems.length === 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a' }}>all done</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {m.attendees && <span style={{ fontSize: '12px', color: '#555' }}>{m.attendees}</span>}
                    <span style={{ color: '#444', fontSize: '18px' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={s.contractRowExpanded}>
                    {m.meeting_action_items && m.meeting_action_items.length > 0 && (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <p style={s.label}>Action Items</p>
                        {m.meeting_action_items.map(a => (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 0', borderBottom: '1px solid #1a1a1a' }}>
                            <button
                              onClick={() => toggleActionItem(a.id, a.status)}
                              style={{ width: '20px', height: '20px', borderRadius: '4px', border: '2px solid', flexShrink: 0, marginTop: '2px', cursor: 'pointer', background: a.status === 'done' ? '#1a4a1a' : 'transparent', borderColor: a.status === 'done' ? '#4ade80' : '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontSize: '12px', fontWeight: '700' }}>
                              {a.status === 'done' ? '✓' : ''}
                            </button>
                            <div style={{ flex: 1 }}>
                              <p style={{ margin: '0 0 3px', fontSize: '14px', color: a.status === 'done' ? '#444' : '#f1f1f1', textDecoration: a.status === 'done' ? 'line-through' : 'none' }}>{a.description}</p>
                              <div style={{ display: 'flex', gap: '12px' }}>
                                {a.assigned_to && <span style={{ fontSize: '12px', color: '#60a5fa' }}>→ {a.assigned_to}</span>}
                                {a.due_date && <span style={{ fontSize: '12px', color: '#888' }}>Due {new Date(a.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {m.meeting_decisions && m.meeting_decisions.length > 0 && (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <p style={s.label}>Decisions</p>
                        {m.meeting_decisions.map(d => (
                          <div key={d.id} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid #1a1a1a', alignItems: 'flex-start' }}>
                            <span style={{ color: '#e8590c', fontSize: '14px', flexShrink: 0 }}>&#x25c6;</span>
                            <p style={{ margin: 0, fontSize: '14px', color: '#ccc', lineHeight: '1.5' }}>{d.description}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {m.raw_transcript && (
                      <details style={{ marginBottom: '1rem' }}>
                        <summary style={{ fontSize: '12px', color: '#555', cursor: 'pointer', userSelect: 'none' }}>View original transcript</summary>
                        <pre style={{ marginTop: '8px', padding: '12px', background: '#080808', border: '1px solid #1a1a1a', borderRadius: '6px', fontSize: '12px', color: '#555', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px', overflowY: 'auto' }}>{m.raw_transcript}</pre>
                      </details>
                    )}

                    <button style={s.btnSmallRed} onClick={() => deleteMeeting(m.id)}>Delete Meeting</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {meetings.length === 0 && !showNewMeeting && (
        <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: '#555', margin: '0 0 1rem' }}>No meetings logged yet.</p>
          <button style={s.btnSmallOrange} onClick={() => setShowNewMeeting(true)}>+ Log First Meeting</button>
        </div>
      )}
    </>
  )
}
