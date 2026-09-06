import { expect, test } from '@playwright/test'
import { resolveIntegrationJiraTarget } from '../../src/integrationTarget'
import {
  detectIntegrationTextDirection,
  formatIntegrationMessage
} from '../../src/integrationEditor'

test('prefers a fictive task Jira work item and otherwise uses the parent', () => {
  expect(resolveIntegrationJiraTarget('vda-402', 'VDA-147')).toBe('VDA-402')
  expect(resolveIntegrationJiraTarget(null, 'vda-147')).toBe('VDA-147')
  expect(resolveIntegrationJiraTarget('', '')).toBeNull()
})

test('formats shared updates and detects Hebrew direction', () => {
  expect(detectIntegrationTextDirection('עדכון ללקוח')).toBe('rtl')
  expect(detectIntegrationTextDirection('Customer update')).toBe('ltr')
  expect(formatIntegrationMessage('  Update  \n\n\n- ready  ')).toBe('Update\n\n• ready')
  expect(formatIntegrationMessage('')).toContain('• Status:')
})
