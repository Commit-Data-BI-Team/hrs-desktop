import { expect, test } from '@playwright/test'
import {
  aggregateEmployeeProjects,
  aggregateSharedProjects,
  getGlobalProjectCapMinutes,
  getSharedProjectCapMinutes,
  getSharedProjectKey,
  replaceEmployeeEntriesWithLive,
  type SharedProjectSourceEntry
} from '../../src/sharedProjects'

const entries: SharedProjectSourceEntry[] = [
  {
    employee: 'Alice',
    customer: 'Acme',
    rawCustomer: 'Acme',
    project: 'Implementation',
    task: 'Discovery',
    minutes: 60,
    taskId: '101'
  },
  {
    employee: 'Bob',
    customer: 'Acme',
    rawCustomer: 'Acme',
    project: 'Implementation',
    task: 'Build',
    minutes: 120,
    taskId: '202'
  },
  {
    employee: 'Alice',
    customer: 'Acme',
    rawCustomer: 'Acme',
    project: 'Support',
    task: 'Support request',
    minutes: 30,
    taskId: '303'
  }
]

test('combines different tasks only when customer and project both match', () => {
  const projects = aggregateSharedProjects(entries)
  const implementation = projects.find(
    project => project.key === getSharedProjectKey('Acme', 'Implementation')
  )
  const support = projects.find(project => project.key === getSharedProjectKey('Acme', 'Support'))

  expect(implementation).toMatchObject({
    customer: 'Acme',
    project: 'Implementation',
    totalMinutes: 180
  })
  expect(implementation?.employees.map(employee => employee.employee).sort()).toEqual([
    'Alice',
    'Bob'
  ])
  expect(implementation?.tasks.map(task => task.task).sort()).toEqual(['Build', 'Discovery'])
  expect(support).toMatchObject({ totalMinutes: 30 })
  expect(support?.employees).toHaveLength(1)
})

test('keeps project identity in each employee breakdown', () => {
  const employees = aggregateEmployeeProjects(entries)
  const alice = employees.find(employee => employee.employee === 'Alice')

  expect(alice?.totalMinutes).toBe(90)
  expect(alice?.customers.map(project => project.project).sort()).toEqual([
    'Implementation',
    'Support'
  ])
})

test('normalizes customer and project keys without mixing different projects', () => {
  expect(getSharedProjectKey(' ACME ', 'Implementation')).toBe(
    getSharedProjectKey('acme', ' implementation ')
  )
  expect(getSharedProjectKey('Acme', 'Implementation')).not.toBe(
    getSharedProjectKey('Acme', 'Support')
  )
})

test('uses one combined cap for all capped tasks in the same project', () => {
  const capMinutes = getSharedProjectCapMinutes(
    [
      { customerName: 'Acme', projectName: 'Implementation', cappedHours: 10 },
      { customerName: 'Acme', projectName: 'Implementation', cappedHours: 5.5 },
      { customerName: 'Acme', projectName: 'Support', cappedHours: 100 }
    ],
    'Acme',
    'Implementation'
  )

  expect(capMinutes).toBe(15.5 * 60)
})

test('uses the independent global project cap when one is configured', () => {
  const capMinutes = getSharedProjectCapMinutes(
    [
      {
        customerName: 'Acme',
        projectName: 'Implementation',
        cappedHours: 10,
        projectCappedHours: 80
      },
      { customerName: 'Acme', projectName: 'Implementation', cappedHours: 5.5 },
      { customerName: 'Acme', projectName: 'Support', projectCappedHours: 100 }
    ],
    'Acme',
    'Implementation'
  )

  expect(capMinutes).toBe(80 * 60)
  expect(
    getGlobalProjectCapMinutes(
      [
        { customerName: 'Acme', projectName: 'Implementation', cappedHours: 10 },
        {
          customerName: 'Acme',
          projectName: 'Implementation',
          projectCappedHours: 80
        }
      ],
      'Acme',
      'Implementation'
    )
  ).toBe(80 * 60)
})

test('keeps peer rows but replaces the signed-in employee with authoritative live HRS rows', () => {
  const shared = [
    { employeeId: '1527', task: 'Stale Chen row' },
    { employeeId: '135', task: 'Dror shared row' }
  ]
  const live = [{ employeeId: '1527', task: 'Current Chen HRS row' }]

  expect(replaceEmployeeEntriesWithLive(shared, '1527', live)).toEqual([
    { employeeId: '135', task: 'Dror shared row' },
    { employeeId: '1527', task: 'Current Chen HRS row' }
  ])
  expect(replaceEmployeeEntriesWithLive(shared, '1527', [])).toEqual([
    { employeeId: '135', task: 'Dror shared row' }
  ])
})
