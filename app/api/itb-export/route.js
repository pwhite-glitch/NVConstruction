import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../lib/server-auth'
import { buildZip } from '../../../lib/zip-builder'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_ROLES = new Set(['pm', 'apm', 'admin', 'super'])

export async function POST(request) {
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  if (!ALLOWED_ROLES.has(auth.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { bidPackageId, selectedPlanIds, itbHtml, projectName } = body

  if (!bidPackageId || !Array.isArray(selectedPlanIds)) {
    return Response.json({ error: 'bidPackageId and selectedPlanIds are required' }, { status: 400 })
  }

  // Verify the bid package exists
  const { data: pkg, error: pkgErr } = await adminSupabase
    .from('bid_packages')
    .select('id, title')
    .eq('id', bidPackageId)
    .maybeSingle()

  if (pkgErr || !pkg) {
    return Response.json({ error: 'Bid package not found' }, { status: 404 })
  }

  // Fetch only plans that belong to this package and match the requested IDs
  // This ensures callers cannot request files from other packages
  const { data: plans, error: plansErr } = await adminSupabase
    .from('bid_plans')
    .select('id, file_name, storage_path')
    .eq('bid_package_id', bidPackageId)
    .in('id', selectedPlanIds.length > 0 ? selectedPlanIds : ['00000000-0000-0000-0000-000000000000'])

  if (plansErr) {
    return Response.json({ error: 'Failed to load document records' }, { status: 500 })
  }

  // Download every selected file; track failures explicitly
  const zipFiles = []
  const failures = []
  const usedNames = new Set()

  for (const plan of (plans || [])) {
    const { data: blob, error: dlErr } = await adminSupabase.storage
      .from('bid-plans')
      .download(plan.storage_path)

    if (dlErr || !blob) {
      failures.push(plan.file_name)
      continue
    }

    const arrayBuf = await blob.arrayBuffer()
    const data = Buffer.from(arrayBuf)

    // Safe, unique filename: strip characters that cause problems in ZIP paths
    let safeName = plan.file_name.replace(/[^\w\s.\-()]/g, '_')
    if (usedNames.has(safeName)) {
      const ext = safeName.match(/(\.[^.]+)$/) ? safeName.match(/(\.[^.]+)$/)[1] : ''
      const base = safeName.slice(0, safeName.length - ext.length)
      let n = 2
      while (usedNames.has(`${base}_${n}${ext}`)) n++
      safeName = `${base}_${n}${ext}`
    }
    usedNames.add(safeName)

    zipFiles.push({ name: `Documents/${safeName}`, data })
  }

  // Fail clearly if any file could not be retrieved — never produce a silent incomplete package
  if (failures.length > 0) {
    return Response.json({
      error: `Could not retrieve the following file${failures.length > 1 ? 's' : ''}: ${failures.join(', ')}. Export aborted. Verify storage and try again.`,
    }, { status: 422 })
  }

  // Prepend the ITB HTML document
  if (itbHtml) {
    const htmlBuf = Buffer.from(itbHtml, 'utf8')
    zipFiles.unshift({ name: 'ITB_Invitation_to_Bid.html', data: htmlBuf })
  }

  // README with context
  const slug = (projectName || pkg.title || 'project').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40)
  const readmeLines = [
    `INVITATION TO BID`,
    `Project: ${projectName || pkg.title}`,
    '='.repeat(58),
    '',
    'Contents:',
    '  ITB_Invitation_to_Bid.html  — Open in any browser, then File > Print > Save as PDF',
    `  Documents/                  — ${zipFiles.filter(f => f.name.startsWith('Documents/')).length} project file(s)`,
    '',
    'Instructions:',
    '  1. Open ITB_Invitation_to_Bid.html in your browser to review the invitation.',
    '  2. Print or Save as PDF for your records.',
    '  3. Documents/ contains original drawings and specifications.',
    '',
    'CONFIDENTIAL — For invited subcontractors only. Do not forward without authorization.',
    '',
    `Generated: ${new Date().toUTCString()}`,
  ]
  zipFiles.unshift({ name: 'README.txt', data: Buffer.from(readmeLines.join('\n'), 'utf8') })

  const zip = buildZip(zipFiles)

  return new Response(zip, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="ITB_${slug}.zip"`,
      'Content-Length': String(zip.length),
    },
  })
}
