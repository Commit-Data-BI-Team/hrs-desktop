type Owner = { id:string; employee_id:number|null }
const day = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const month = /^\d{4}-(?:0[1-9]|1[0-2])$/
export function pendingDay(owner:Owner|null|undefined,date:string) {
  return owner && /^[a-zA-Z0-9-]{1,100}$/.test(owner.id) && day.test(date)
    ? [owner.id,owner.employee_id??'unassigned',date].join('|') : ''
}
export function validPendingScope(key:string) {
  if (month.test(key)) return true // read old backlog, never replay an unowned month automatically
  const [id,num,date,...rest]=key.split('|')
  return !rest.length && /^[a-zA-Z0-9-]{1,100}$/.test(id) && /^(?:unassigned|[1-9]\d*)$/.test(num) && day.test(date)
}
export function retryDate(key:string, owner:Owner|null|undefined) {
  if (!validPendingScope(key) || !owner) return null
  const [id,num,date]=key.split('|')
  return id===owner.id && (num==='unassigned' || num===String(owner.employee_id)) ? date || null : null
}
