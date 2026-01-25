import { getCustomAuth } from '../config'

const BASE = 'https://hrs.comm-it.co.il/api'

export async function getReports(startDate: string, endDate: string) {
  const token = getCustomAuth()
  if (!token) {
    throw new Error('Not authenticated')
  }

  const res = await fetch(
    `${BASE}/getReports/?startDate=${startDate}&endDate=${endDate}`,
    {
      headers: {
        Accept: 'application/json',
        CustomAuth: token
      }
    }
  )

  if (!res.ok) {
    throw new Error(`getReports ${res.status}`)
  }

  return res.json()
}