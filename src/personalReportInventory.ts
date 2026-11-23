type Incoming = Record<string, unknown> & {id:string; report_date:string}
type Saved = Incoming & {synced_by:string|null}
const scope = (r:Incoming) => JSON.stringify([r.employee_id,r.report_date,r.task_id])
const folded = (v:unknown) => typeof v==='string' ? v.trim().toLowerCase().replace(/\s+/g,' ') : ''
const sameImport = (r:Incoming, m:Saved) => m.synced_by===null && r.employee_id!=null && r.task_id!=null &&
  typeof r.comment==='string' && r.comment.trim()!=='' && r.comment.trim()===String(m.comment??'').trim() &&
  Number(r.seconds)>0 && r.seconds===m.seconds && folded(r.customer)===folded(m.customer) &&
  folded(r.project)===folded(m.project) &&
  (!m.shared_fictive_task_id || !r.shared_fictive_task_id || m.shared_fictive_task_id===r.shared_fictive_task_id)

// Only the authenticated employee's personal snapshot can adopt a duration-only
// import. Missing times are not invented; adoption updates the existing row
// in place using a version check, even if the live HRS key includes a time.
export function planPersonalWrites<T extends Incoming>(rows:T[], existing:Saved[], actor:string, days:Set<string>) {
  const saved=new Map(existing.map(r=>[r.id,r])), ids=new Set(rows.map(r=>r.id))
  const creates:T[]=[], updates:T[]=[], stale:string[]=[], review=new Set<string>()
  const imports=new Map<string,Saved[]>(), live=new Map<string,T[]>()
  const adopt:Array<{previous:Saved; row:T}>=[], blocked=new Set<string>()
  for(const m of existing) if(m.source==='hrs_manual' && days.has(m.report_date)) {
    const k=scope(m); imports.set(k,[...(imports.get(k)??[]),m])
  }
  for(const r of rows) { const k=scope(r); live.set(k,[...(live.get(k)??[]),r]) }
  const adoptedIds=new Set<string>()
  for(const [k,manual] of imports) {
    const proposals:Array<{previous:Saved; row:T}>=[]
    for(const m of manual) {
      const matches=(live.get(k)??[]).filter(r=>sameImport(r,m))
      if(matches.length!==1 || manual.filter(other=>sameImport(matches[0],other)).length!==1 ||
        (saved.has(matches[0].id) && matches[0].id!==m.id)) { blocked.add(k); break }
      proposals.push({previous:m,row:matches[0]})
    }
    if(blocked.has(k)) { for(const m of manual) review.add(m.id); continue }
    for(const p of proposals) { adopt.push(p); adoptedIds.add(p.row.id) }
  }
  for (const row of rows) {
    if(adoptedIds.has(row.id) || blocked.has(scope(row))) continue
    const old=saved.get(row.id)
    if (!old) { creates.push(row); continue }
    if (old.synced_by!==actor || old.report_date!==row.report_date) { review.add(row.id); continue }
    if (Object.keys(row).some(k=>k!=='synced_at' && k!=='synced_by' && (row[k]??null)!==(old[k]??null))) updates.push(row)
  }
  for (const old of existing) {
    if (old.source==='hrs_manual' || blocked.has(scope(old)) || !days.has(old.report_date) || ids.has(old.id)) continue
    if (old.synced_by===actor) stale.push(old.id)
    else review.add(old.id)
  }
  return {creates,updates,adopt,stale,review:review.size}
}
