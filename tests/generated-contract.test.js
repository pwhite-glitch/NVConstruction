import { describe, it, expect, jest } from '@jest/globals'
import {
  generatedContractPath, esignedContractPath, escapeHtml, withSignatureCertificate, signatureCertificateHtml,
  saveGeneratedContract, saveSignedContract, latestGeneratedContractPath, CONTRACT_BUCKET,
} from '../lib/generated-contract'

const SC = 'e2b1dd0f-696f-4d19-861c-765ea8d52f43'
const AT = new Date('2026-10-27T15:04:05.678Z')

// Minimal stand-in for the service-role Supabase client: records storage uploads
// and applies subcontracts updates (eq / is filters) to an in-memory row.
function fakeAdmin({ row = { id: SC, signed_contract_url: null }, updateError = null, uploadError = null, listed = [] } = {}) {
  const uploads = []
  const admin = {
    row, uploads,
    storage: {
      from: (bucket) => ({
        upload: async (path, body, opts) => { uploads.push({ bucket, path, body: body.toString('utf8'), opts }); return { error: uploadError } },
        list: async () => ({ data: listed }),
      }),
    },
    from: (table) => {
      expect(table).toBe('subcontracts')
      let patch, filters = []
      const q = {
        update: (p) => { patch = p; return q },
        eq: (col, val) => { filters.push(r => r[col] === val); return q },
        is: (col, val) => { filters.push(r => (r[col] ?? null) === val); return q },
        // PostgREST or(): 'a.is.null,a.eq.x' → any part matches
        or: (expr) => {
          const parts = expr.split(',').map(p => p.split('.'))
          filters.push(r => parts.some(([c, op, v]) => op === 'is' ? (r[c] ?? null) === null : r[c] === v))
          return q
        },
        select: () => q,
        then: (resolve) => {
          if (updateError) return resolve({ data: null, error: updateError })
          const hit = filters.every(f => f(row))
          if (hit) Object.assign(row, patch)
          resolve({ data: hit ? [{ id: row.id }] : [], error: null })
        },
      }
      return q
    },
  }
  return admin
}

describe('paths', () => {
  it('builds sortable, filename-safe paths per subcontract', () => {
    expect(generatedContractPath(SC, AT)).toBe(`subcontracts/${SC}/generated-2026-10-27T15-04-05-678Z.html`)
    expect(esignedContractPath(SC, AT)).toBe(`contracts/${SC}/esigned-2026-10-27T15-04-05-678Z.html`)
  })
  it('rejects ids that are not uuids (no path traversal)', () => {
    expect(() => generatedContractPath('../x', AT)).toThrow()
    expect(() => esignedContractPath('', AT)).toThrow()
  })
})

describe('signature certificate', () => {
  it('escapes signer-supplied text and goes before </body>', () => {
    const out = withSignatureCertificate('<html><body><p>Contract</p></body></html>', {
      signature_text: '<script>x</script> Al', signer_email: 'a@b.com', signed_at: AT.toISOString(), request_id: 'r1',
    })
    expect(escapeHtml('<a "b">')).toBe('&lt;a &quot;b&quot;&gt;')
    expect(out).not.toContain('<script>x</script>')
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt; Al')
    expect(out).toContain('a@b.com')
    expect(out.indexOf('Electronic Signature Record')).toBeLessThan(out.indexOf('</body>'))
    expect(out.indexOf('<p>Contract</p>')).toBeLessThan(out.indexOf('Electronic Signature Record'))
  })
  it('adds Title and On behalf of rows when given, escaped', () => {
    const out = signatureCertificateHtml({
      signature_text: 'Jane Doe', signer_name: 'Jane Doe', signer_title: '<script>t</script> Owner', company_name: 'JC & <script>c</script>',
      signer_email: 'a@b.com', signed_at: AT.toISOString(), request_id: 'r1',
    })
    expect(out).toMatch(/>Title<\/td><td[^>]*>&lt;script&gt;t&lt;\/script&gt; Owner</)
    expect(out).toMatch(/>On behalf of<\/td><td[^>]*>JC &amp; &lt;script&gt;c&lt;\/script&gt;</)
    expect(out).not.toContain('<script>')
    expect(out.indexOf('Signed by')).toBeLessThan(out.indexOf('>Title<'))
    expect(out).toContain('October 27, 2026 at 10:04 AM CT')
  })
  it('omits Title and On behalf of when blank', () => {
    const out = signatureCertificateHtml({ signature_text: 'Al', signer_name: 'Al', signer_title: '  ', company_name: null, signer_email: 'a@b.com', signed_at: AT.toISOString() })
    expect(out).not.toContain('>Title<')
    expect(out).not.toContain('On behalf of')
    expect(out).toContain('Signed by')
  })
})

describe('saveGeneratedContract', () => {
  it('uploads the HTML to the documents bucket and records it on the subcontract', async () => {
    const admin = fakeAdmin()
    const res = await saveGeneratedContract(admin, { subcontractId: SC, html: '<p>hi</p>', userId: 'u1', at: AT })
    expect(admin.uploads).toHaveLength(1)
    expect(admin.uploads[0]).toMatchObject({ bucket: CONTRACT_BUCKET, path: res.path, body: '<p>hi</p>' })
    expect(admin.uploads[0].opts.contentType).toMatch(/text\/html/)
    expect(res).toEqual({ path: generatedContractPath(SC, AT), generated_at: AT.toISOString(), recorded: true })
    expect(admin.row).toMatchObject({ generated_contract_path: res.path, generated_at: AT.toISOString(), generated_by: 'u1' })
  })

  it('keeps the file when the row update fails (migration 031 not applied)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const admin = fakeAdmin({ updateError: { message: 'column "generated_contract_path" does not exist' } })
    const res = await saveGeneratedContract(admin, { subcontractId: SC, html: '<p>hi</p>', at: AT })
    expect(admin.uploads).toHaveLength(1)
    expect(res.recorded).toBe(false)
    expect(res.path).toBe(generatedContractPath(SC, AT))
  })

  it('throws when the upload fails so callers can report it', async () => {
    const admin = fakeAdmin({ uploadError: { message: 'bucket missing' } })
    await expect(saveGeneratedContract(admin, { subcontractId: SC, html: 'x', at: AT })).rejects.toThrow('bucket missing')
  })
})

describe('saveSignedContract', () => {
  const certificate = { signature_text: 'Al Swihart', signer_email: 'a@b.com', signed_at: AT.toISOString() }

  it('stores the signed copy and sets signed_contract_url', async () => {
    const admin = fakeAdmin()
    const res = await saveSignedContract(admin, { subcontractId: SC, html: '<body>Contract</body>', certificate, at: AT })
    expect(res).toEqual({ path: esignedContractPath(SC, AT), linked: true })
    expect(admin.row.signed_contract_url).toBe(res.path)
    expect(admin.uploads[0].body).toContain('Electronic Signature Record')
    expect(admin.uploads[0].body).toContain('Al Swihart')
  })

  it('does not replace a signed contract that is already on file', async () => {
    const admin = fakeAdmin({ row: { id: SC, signed_contract_url: `contracts/${SC}/uploaded.pdf` } })
    const res = await saveSignedContract(admin, { subcontractId: SC, html: '<body></body>', certificate, at: AT })
    expect(res.linked).toBe(false)
    expect(admin.row.signed_contract_url).toBe(`contracts/${SC}/uploaded.pdf`)
    expect(admin.uploads).toHaveLength(1)
  })

  it('on a blank row also stamps signed_at (from `at`) and status signed', async () => {
    const admin = fakeAdmin({ row: { id: SC, status: 'active', signed_contract_url: null, signed_at: null } })
    const res = await saveSignedContract(admin, { subcontractId: SC, html: '<body></body>', certificate, at: AT })
    expect(res.linked).toBe(true)
    expect(admin.row).toMatchObject({ signed_contract_url: res.path, signed_at: AT.toISOString(), status: 'signed' })
  })

  it('keeps an uploaded PDF but fills a missing signed_at; an existing signed_at is not moved', async () => {
    const admin = fakeAdmin({ row: { id: SC, status: 'active', signed_contract_url: `contracts/${SC}/uploaded.pdf`, signed_at: null } })
    await saveSignedContract(admin, { subcontractId: SC, html: '', certificate, at: AT })
    expect(admin.row).toMatchObject({ signed_contract_url: `contracts/${SC}/uploaded.pdf`, signed_at: AT.toISOString(), status: 'signed' })
    const earlier = '2026-01-01T00:00:00.000Z'
    const admin2 = fakeAdmin({ row: { id: SC, status: 'active', signed_contract_url: null, signed_at: earlier } })
    await saveSignedContract(admin2, { subcontractId: SC, html: '', certificate, at: AT })
    expect(admin2.row.signed_at).toBe(earlier)
  })

  it('does not overwrite a draft or complete status', async () => {
    for (const status of ['draft', 'complete']) {
      const admin = fakeAdmin({ row: { id: SC, status, signed_contract_url: null, signed_at: null } })
      await saveSignedContract(admin, { subcontractId: SC, html: '', certificate, at: AT })
      expect(admin.row.status).toBe(status)
      expect(admin.row.signed_at).toBe(AT.toISOString())
    }
  })
})

describe('latestGeneratedContractPath', () => {
  it('returns the newest generated file in the subcontract folder', async () => {
    const admin = fakeAdmin({ listed: [{ name: 'generated-2026-10-27T15-04-05-678Z.html' }] })
    expect(await latestGeneratedContractPath(admin, SC)).toBe(`subcontracts/${SC}/generated-2026-10-27T15-04-05-678Z.html`)
    expect(await latestGeneratedContractPath(fakeAdmin(), SC)).toBeNull()
    expect(await latestGeneratedContractPath(admin, 'bad')).toBeNull()
  })
})
