import { sameCompany } from './company-name'

// Who to send a subcontract to for e-signature, as { name, email } (either may be '').
// In order: the sub user on the contract, the company's email on file
// (companies.email), then the sub directory contact for the company.
// Safe to import on client and server.
export function pickSignerContact({ contract, assignments = [], company = null, directory = [] }) {
  if (!contract) return { name: '', email: '' }
  const companyName = contract.vendor_name || company?.name || ''

  const user = contract.sub_id && assignments.find(a => a.sub_id === contract.sub_id && a.sub_email)
  if (user) return { name: user.profiles?.full_name || '', email: user.sub_email }

  const dir = directory.find(d => d.email && sameCompany(d.company_name, companyName))
  if (company?.email) return { name: dir?.contact_name || '', email: company.email }
  if (dir) return { name: dir.contact_name || '', email: dir.email }
  return { name: '', email: '' }
}
