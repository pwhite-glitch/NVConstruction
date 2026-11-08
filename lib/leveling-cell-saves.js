// Per-cell save logic for the bid leveling matrix (app/components/bid/LevelingMatrix.js).
// No React here, so the save/response interleavings can be tested directly.
//
//  • commit: every save for a cell bumps that cell's sequence number. Only the
//    response to the newest save may update the saved entry, the error, the
//    saving flag or the draft; an older response is ignored.
//  • serialized writes: at most one request per cell is on the wire. A newer
//    save waits until the cell's in-flight request has finished (the server has
//    written it), so the newest intent is always the LAST write for that cell and
//    is what a later GET / reload returns. A queued save that has been superseded
//    by a newer queued save for the same fields is dropped (only the latest
//    intended patch is sent).
//  • flushAmount: a typed amount equal to the saved amount is a no-op ONLY when
//    no save for that cell is in flight or queued. If one is (e.g. 0 → 100 sent,
//    then the user types 0 again), the revert is the newest intent: it is sent
//    as a compensating save after the 100, which also invalidates the 100's response.
import { levelingKey, entryMap, parseLevelingAmount } from './bid-leveling'

const savedAmountOf = entry => (entry?.amount === null || entry?.amount === undefined || entry?.amount === '' ? null : Number(entry.amount))

// state = { reqSeq, inFlight, chains, draftsRef, entriesRef, timers } (refs: { current })
//   chains.current[k] = { tail: Promise, latest: { field: seq } } — the cell's save queue
// io = { saveCell(body) → { entry } | { error }, onEntry, setSaving, setErrors, clearDraft, bidPackageId }
export function levelingCellOps(state, io) {
  const { reqSeq, inFlight, draftsRef, entriesRef, timers } = state
  const chains = state.chains || (state.chains = { current: {} })

  // Returns true only when this is still the newest save for the cell and it succeeded.
  async function commit(sub, item, patch) {
    const k = levelingKey(sub.id, item.id)
    const seq = (reqSeq.current[k] || 0) + 1
    reqSeq.current[k] = seq
    inFlight.current[k] = (inFlight.current[k] || 0) + 1
    io.setSaving(p => ({ ...p, [k]: true }))

    // Join the cell's queue: wait for every earlier save on this cell to finish.
    // With nothing pending the request goes out immediately.
    const chain = chains.current[k] || (chains.current[k] = { tail: null, latest: {} })
    const fields = Object.keys(patch)
    for (const f of fields) chain.latest[f] = seq
    const prev = chain.tail
    let release
    const mine = new Promise(res => { release = res })
    chain.tail = mine

    let r
    try {
      if (prev) await prev
      // A newer save for the same fields is queued behind us: it carries the latest
      // intent, so this one is never sent.
      if (fields.length && fields.every(f => chain.latest[f] > seq)) r = { superseded: true }
      else r = await io.saveCell({ bid_package_id: io.bidPackageId, bid_submission_id: sub.id, bid_scope_item_id: item.id, ...patch })
    } catch (e) {
      r = { error: e?.message || 'Not saved.' }
    } finally {
      inFlight.current[k] = Math.max(0, (inFlight.current[k] || 0) - 1)
      if (chain.tail === mine && chains.current[k] === chain) delete chains.current[k]
      release()
    }
    if (reqSeq.current[k] !== seq) return false
    io.setSaving(p => { const n = { ...p }; delete n[k]; return n })
    if (r.error) { io.setErrors(p => ({ ...p, [k]: r.error })); return false }
    io.setErrors(p => { const n = { ...p }; delete n[k]; return n })
    io.onEntry?.(r.entry)
    return true
  }

  function flushAmount(sub, item) {
    const k = levelingKey(sub.id, item.id)
    clearTimeout(timers.current[k])
    delete timers.current[k]
    if (!(k in draftsRef.current)) return
    const text = draftsRef.current[k]
    const p = parseLevelingAmount(text)
    if (p.error) { io.setErrors(e => ({ ...e, [k]: p.error })); return }
    const saved = savedAmountOf(entryMap(entriesRef.current)[k])
    // Same as saved and nothing pending for this cell → nothing to do.
    if (saved === p.amount && !(inFlight.current[k] > 0)) { io.clearDraft(k); return }
    return commit(sub, item, { amount: p.amount }).then(ok => { if (ok && draftsRef.current[k] === text) io.clearDraft(k); return ok })
  }

  return { commit, flushAmount }
}
