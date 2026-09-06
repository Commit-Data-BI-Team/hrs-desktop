export function resolveIntegrationJiraTarget(
  fictiveTaskIssueKey?: string | null,
  parentIssueKey?: string | null
) {
  const fictiveTarget = fictiveTaskIssueKey?.trim().toUpperCase()
  if (fictiveTarget) return fictiveTarget
  const parentTarget = parentIssueKey?.trim().toUpperCase()
  return parentTarget || null
}
