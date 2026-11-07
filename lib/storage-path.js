// Storage paths for job files are laid out as "<job_id>/...". These helpers
// pull the job id back out (so routes can run the job-access check on it) and
// make a file name safe to put in a path. No imports: browser and server use it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Leading job id of a storage path, or null when the path is not "<uuid>/<something>"
// or tries to climb out of its folder.
export function jobIdFromPath(path) {
  if (typeof path !== 'string' || !path) return null
  const parts = path.split('/')
  if (parts.length < 2 || parts.some(p => p === '' || p === '.' || p === '..')) return null
  return UUID_RE.test(parts[0]) ? parts[0].toLowerCase() : null
}

// File name with anything storage paths choke on (spaces, #, ?, brackets, %,
// slashes, quotes...) replaced by "_". Keeps letters, digits, dot, dash, underscore.
export function safeFileName(name) {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-120)
  return cleaned || 'file'
}

// Why a new upload path is not allowed, or null. It must be exactly
// "<job_id>/<safe file name>" (and that job, when `jobId` is given).
export function jobUploadPathError(path, jobId = null) {
  const pathJob = jobIdFromPath(path)
  if (!pathJob) return 'Path must start with the job id.'
  if (jobId && pathJob !== String(jobId).toLowerCase()) return 'File path does not match the job.'
  const parts = path.split('/')
  if (parts.length !== 2 || parts[1] !== safeFileName(parts[1])) return 'File name must be a safe name inside the job folder.'
  return null
}
