import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'sales-docs'

// Portal GET — no auth required, token IS the credential
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) return Response.json({ error: 'token required' }, { status: 400 })

    // Validate token
    const { data: access } = await adminSupabase
      .from('customer_portal_access')
      .select('id, order_id, email, name, revoked_at')
      .eq('access_token', token)
      .maybeSingle()

    if (!access || access.revoked_at) {
      return Response.json({ error: 'invalid_token' }, { status: 404 })
    }

    // Signed URL for a shared document
    const docPath = searchParams.get('doc_url')
    if (docPath) {
      const { data, error } = await adminSupabase.storage.from(BUCKET).createSignedUrl(docPath, 3600)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ url: data.signedUrl })
    }

    // Log access time
    await adminSupabase
      .from('customer_portal_access')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('id', access.id)

    // Fetch order — return only customer-safe fields (never internal_cost/estimated_profit/internal_notes)
    const { data: order } = await adminSupabase
      .from('sales_orders')
      .select(`
        order_number, division, stage, customer_name, customer_company,
        site_address, city, state, zip, scope_description, products, options,
        width_ft, length_ft, height_ft, building_use,
        roof_type, roof_size_sqft, building_type,
        salesperson_name, ops_owner_name,
        expected_delivery_date, confirmed_delivery_date, delivery_notes,
        expected_install_date, confirmed_install_date, install_notes,
        contract_signed_at, completed_at
      `)
      .eq('id', access.order_id)
      .maybeSingle()

    if (!order) return Response.json({ error: 'Order not found' }, { status: 404 })

    // Docs: only those explicitly shared with customer
    const { data: docs } = await adminSupabase
      .from('sales_order_docs')
      .select('id, file_name, category, created_at, storage_path, notes')
      .eq('order_id', access.order_id)
      .eq('visible_to_customer', true)
      .order('created_at', { ascending: false })

    // Updates: only customer-visible ones
    const { data: updates } = await adminSupabase
      .from('sales_order_updates')
      .select('id, body, created_at, author_name')
      .eq('order_id', access.order_id)
      .eq('visible_to_customer', true)
      .order('created_at', { ascending: false })

    return Response.json({
      order,
      docs:          docs    || [],
      updates:       updates || [],
      customer_name: access.name,
      access_id:     access.id,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Portal POST — mixed: some actions need staff auth, send_question uses token auth
export async function POST(request) {
  try {
    const body = await request.json()
    const { action } = body

    // ── Customer sends a question (token-authenticated) ────────────────────
    if (action === 'send_question') {
      const { token, access_id, body: questionText } = body
      if (!token || !questionText) return Response.json({ error: 'token and body required' }, { status: 400 })

      const { data: access } = await adminSupabase
        .from('customer_portal_access')
        .select('id, order_id, name, email, revoked_at')
        .eq('access_token', token)
        .eq('id', access_id)
        .maybeSingle()

      if (!access || access.revoked_at) return Response.json({ error: 'Invalid token' }, { status: 403 })

      await adminSupabase.from('sales_order_updates').insert({
        order_id:           access.order_id,
        author_id:          null,
        author_name:        access.name || access.email,
        body:               `[Customer question] ${questionText}`,
        visible_to_customer: false,
        update_type:        'question',
      })

      await adminSupabase.from('sales_order_history').insert({
        order_id:   access.order_id,
        actor_id:   null,
        actor_name: access.name || access.email,
        action:     'customer_question',
        details:    { access_id },
      })

      return Response.json({ ok: true })
    }

    // Remaining actions require staff auth header
    const authHeader = request.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate staff token
    const { createClient: createAnonClient } = await import('@supabase/supabase-js')
    const anonClient = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    const { data: { user } } = await anonClient.auth.getUser(authHeader.slice(7).trim())
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await adminSupabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    const role = profile?.role

    const STAFF_ROLES = new Set(['pm', 'apm', 'admin', 'metal_rep', 'roofing_rep'])
    if (!STAFF_ROLES.has(role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    // ── Invite customer ────────────────────────────────────────────────────────
    if (action === 'invite') {
      const { order_id, email, name, inviter_name } = body
      if (!order_id || !email) return Response.json({ error: 'order_id and email required' }, { status: 400 })

      // Generate a secure token
      const crypto = await import('crypto')
      const access_token = crypto.randomBytes(32).toString('hex')

      const { data, error } = await adminSupabase
        .from('customer_portal_access')
        .insert({ order_id, email, name: name || null, access_token, invited_by: user.id, invited_by_name: inviter_name || null })
        .select('id')
        .single()

      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Send invitation email via Resend
      const { data: order } = await adminSupabase
        .from('sales_orders')
        .select('order_number, customer_name, salesperson_name')
        .eq('id', order_id)
        .maybeSingle()

      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.nvim.co'}/portal/${access_token}`

      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const emailHtml = `
          <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111827">
            <div style="background:#1a2332;padding:20px 24px;border-radius:8px 8px 0 0">
              <span style="color:#fff;font-weight:700;font-size:18px">NV Construction</span>
            </div>
            <div style="background:#fff;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
              <p style="margin:0 0 12px;font-size:15px">Hi ${name || 'there'},</p>
              <p style="margin:0 0 16px;font-size:14px;color:#374151">
                You've been invited to view your order details for <strong>${order?.order_number || ''}</strong> through the NV Construction customer portal.
              </p>
              <a href="${portalUrl}" style="display:inline-block;background:#e8590c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-bottom:20px">
                View My Order →
              </a>
              <p style="margin:0;font-size:12px;color:#9ca3af">
                Questions? Contact your project representative: ${order?.salesperson_name || 'your sales rep'}.
              </p>
            </div>
          </div>
        `
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'NV Construction <noreply@nvim.co>',
          to:   email,
          subject: `Your order portal — ${order?.order_number || 'NV Construction'}`,
          html: emailHtml,
        })

        // Log the email
        await adminSupabase.from('sales_email_log').insert({
          order_id, template: 'portal_invite', to_email: email, subject: `Your order portal — ${order?.order_number}`,
          status: 'sent', sent_by: user.id,
          dedup_key: `portal_invite_${data.id}`,
        }).onConflict('dedup_key').ignore()
      } catch (emailErr) {
        // Log failure but don't block the invite
        await adminSupabase.from('sales_email_log').insert({
          order_id, template: 'portal_invite', to_email: email,
          status: 'failed', error_message: emailErr.message, sent_by: user.id,
        })
      }

      await adminSupabase.from('sales_order_history').insert({
        order_id,
        actor_id:   user.id,
        actor_name: inviter_name || 'Staff',
        action:     'customer_invited',
        details:    { email, name: name || null, access_id: data.id },
      })

      return Response.json({ ok: true, id: data.id })
    }

    // ── Revoke access ──────────────────────────────────────────────────────────
    if (action === 'revoke') {
      const { id } = body
      if (!id) return Response.json({ error: 'id required' }, { status: 400 })

      const { data: access } = await adminSupabase.from('customer_portal_access').select('order_id,email').eq('id', id).maybeSingle()
      if (!access) return Response.json({ error: 'Not found' }, { status: 404 })

      await adminSupabase.from('customer_portal_access').update({ revoked_at: new Date().toISOString() }).eq('id', id)

      await adminSupabase.from('sales_order_history').insert({
        order_id:   access.order_id,
        actor_id:   user.id,
        actor_name: 'Staff',
        action:     'customer_access_revoked',
        details:    { access_id: id, email: access.email },
      })

      return Response.json({ ok: true })
    }

    // ── List accesses for an order ─────────────────────────────────────────────
    if (action === 'list') {
      const { order_id } = body
      if (!order_id) return Response.json({ error: 'order_id required' }, { status: 400 })

      const { data, error } = await adminSupabase
        .from('customer_portal_access')
        .select('id, email, name, invited_at, last_accessed_at, revoked_at, invited_by_name')
        .eq('order_id', order_id)
        .order('invited_at', { ascending: false })

      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ accesses: data || [] })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
