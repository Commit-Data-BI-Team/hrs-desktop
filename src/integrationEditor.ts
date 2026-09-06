export type IntegrationTextDirection = 'ltr' | 'rtl'

export function detectIntegrationTextDirection(value: string): IntegrationTextDirection {
  for (const character of value) {
    if (/[\u0590-\u08FF]/.test(character)) return 'rtl'
    if (/[A-Za-z\u00C0-\u02AF]/.test(character)) return 'ltr'
  }
  return 'ltr'
}

export function formatIntegrationMessage(value: string) {
  if (!value.trim()) {
    return '*Update*\n\n• Status: \n• Progress: \n• Blockers: \n• Next step: '
  }

  const normalizedLines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line =>
      line
        .trim()
        .replace(/^[-•]\s+/, '• ')
        .replace(/^(\d+)[.)]\s+/, '$1. ')
    )

  const compactLines: string[] = []
  for (const line of normalizedLines) {
    if (!line && compactLines.at(-1) === '') continue
    compactLines.push(line)
  }
  return compactLines.join('\n').trim()
}
