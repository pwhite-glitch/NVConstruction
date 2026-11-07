'use client'

// Under a new-job "Job number" field: duplicate warning, or a note when the
// suggestion could not be loaded. `jn` is the useJobNumbers() result.
export default function JobNumberHint({ jn, value }) {
  const warn = jn?.warning(value)
  if (warn) return <p role="alert" style={{ margin: '4px 0 0', fontSize: '12px', color: '#b45309' }}>{warn}</p>
  if (jn?.error) return <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>Couldn&apos;t load existing job numbers to suggest the next one. Enter it manually.</p>
  return null
}
