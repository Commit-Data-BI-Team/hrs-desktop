import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowsMaximize,
  IconCalendarEvent,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconGripVertical,
  IconMessageCircle,
  IconPaperclip,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconUsers,
  IconX
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type {
  JiraAgileBoard,
  JiraSprint,
  JiraSprintIssue,
  JiraSprintIssueDetails,
  SupabaseSprintTaskUsage
} from './types/hrs'

type SprintProjectStatus = {
  configured: boolean
  projectKey: string
  projectKeys?: string[]
}

type SprintColumn = 'backlog' | 'todo' | 'indeterminate' | 'done'

type SprintDragState = {
  issueKey: string
  source: SprintColumn
}

type SprintUndo = {
  label: string
  run: () => Promise<void>
}

type SprintCatalogItem = {
  board: JiraAgileBoard
  sprint: JiraSprint
}

type SprintCachedView = {
  backlogIssues: JiraSprintIssue[]
  sprintIssues: JiraSprintIssue[]
  supabaseUsage: Record<string, SupabaseSprintTaskUsage>
  savedAt: string
}

type SprintBoardCache = {
  catalog: SprintCatalogItem[]
  sprintSelection: string | null
  views: Record<string, SprintCachedView>
}

type Props = {
  jiraStatus: SprintProjectStatus | null
  linkedIssueKeys: string[]
  supabaseConnected: boolean
  canEdit: boolean
  currentEmployeeId: number | null
  currentEmployeeName: string | null
  compact?: boolean
  onExpand?: () => void
  onClose: () => void
}

const COLUMN_LABELS: Record<SprintColumn, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  indeterminate: 'In Progress',
  done: 'Done'
}

const SPRINT_BOARD_CACHE_KEY = 'hrs-sprint-board-cache-v1'

function readSprintBoardCache(): SprintBoardCache {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPRINT_BOARD_CACHE_KEY) || '{}') as Partial<
      SprintBoardCache
    >
    return {
      catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
      sprintSelection:
        typeof parsed.sprintSelection === 'string' ? parsed.sprintSelection : null,
      views: parsed.views && typeof parsed.views === 'object' ? parsed.views : {}
    }
  } catch {
    return { catalog: [], sprintSelection: null, views: {} }
  }
}

function writeSprintBoardCache(cache: SprintBoardCache) {
  try {
    localStorage.setItem(SPRINT_BOARD_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Cache is best-effort; live Jira and Supabase remain authoritative.
  }
}

function formatSeconds(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours}h ${remainder}m`
  if (hours) return `${hours}h`
  return `${remainder}m`
}

function categoryForStatusName(value: string): Exclude<SprintColumn, 'backlog'> {
  const normalized = value.toLowerCase()
  if (/done|closed|resolved|complete/.test(normalized)) return 'done'
  if (/progress|review|testing|blocked/.test(normalized)) return 'indeterminate'
  return 'todo'
}

function statusNameForColumn(column: Exclude<SprintColumn, 'backlog'>) {
  if (column === 'done') return 'Done'
  if (column === 'indeterminate') return 'In Progress'
  return 'To Do'
}

function sprintSelectionValue(item: SprintCatalogItem) {
  return `${item.board.id}:${item.sprint.id}`
}

function sprintTimestamp(sprint: JiraSprint) {
  const value = Date.parse(sprint.endDate ?? sprint.startDate ?? '')
  return Number.isFinite(value) ? value : 0
}

function formatSprintDate(value: string | null) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date)
}

function formatCompletionDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function dateInIsrael(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function sprintUsageRange(sprint: JiraSprint) {
  const today = dateInIsrael(new Date().toISOString())!
  const start = dateInIsrael(sprint.startDate) ?? `${today.slice(0, 7)}-01`
  const sprintEnd = dateInIsrael(sprint.endDate)
  const end = sprintEnd && sprintEnd < today ? sprintEnd : today
  return { start, end: end < start ? start : end }
}

function getRemainingSprintDays(sprint: JiraSprint) {
  const today = dateInIsrael(new Date().toISOString())
  const end = dateInIsrael(sprint.endDate)
  if (!today || !end) return null
  const todayMs = Date.parse(`${today}T00:00:00.000Z`)
  const endMs = Date.parse(`${end}T00:00:00.000Z`)
  return Math.max(0, Math.ceil((endMs - todayMs) / (24 * 60 * 60 * 1000)))
}

export function SprintBoard({
  jiraStatus,
  linkedIssueKeys,
  supabaseConnected,
  canEdit,
  currentEmployeeId,
  currentEmployeeName,
  compact = false,
  onExpand,
  onClose
}: Props) {
  const initialCache = useMemo(readSprintBoardCache, [])
  const initialView = initialCache.sprintSelection
    ? initialCache.views[initialCache.sprintSelection]
    : undefined
  const projectKeys = useMemo(() => {
    const values = jiraStatus?.projectKeys?.length
      ? jiraStatus.projectKeys
      : jiraStatus?.projectKey
        ? [jiraStatus.projectKey]
        : ['VDA', 'LSM']
    return Array.from(new Set(values.map(value => value.trim().toUpperCase()).filter(Boolean)))
  }, [jiraStatus])
  const [catalog, setCatalog] = useState<SprintCatalogItem[]>(initialCache.catalog)
  const [sprintSelection, setSprintSelection] = useState<string | null>(
    initialCache.sprintSelection
  )
  const [reporterFilter, setReporterFilter] = useState<string | null>(null)
  const [compactColumn, setCompactColumn] = useState<SprintColumn>('indeterminate')
  const [backlogIssues, setBacklogIssues] = useState<JiraSprintIssue[]>(
    initialView?.backlogIssues ?? []
  )
  const [sprintIssues, setSprintIssues] = useState<JiraSprintIssue[]>(
    initialView?.sprintIssues ?? []
  )
  const [supabaseUsage, setSupabaseUsage] = useState<
    Record<string, SupabaseSprintTaskUsage>
  >(initialView?.supabaseUsage ?? {})
  const [loadingCatalog, setLoadingCatalog] = useState(!initialCache.catalog.length)
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [loadingSupabaseUsage, setLoadingSupabaseUsage] = useState(false)
  const [catalogRefreshTick, setCatalogRefreshTick] = useState(0)
  const [mutationLoading, setMutationLoading] = useState(false)
  const [startLoadingKey, setStartLoadingKey] = useState<string | null>(null)
  const [completionLoadingKey, setCompletionLoadingKey] = useState<string | null>(null)
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null)
  const [detailsLoadingKey, setDetailsLoadingKey] = useState<string | null>(null)
  const [detailsByIssue, setDetailsByIssue] = useState<Record<string, JiraSprintIssueDetails>>({})
  const [detailsErrorByIssue, setDetailsErrorByIssue] = useState<Record<string, string>>({})
  const [dragState, setDragState] = useState<SprintDragState | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<SprintColumn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [supabaseUsageError, setSupabaseUsageError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [undoAction, setUndoAction] = useState<SprintUndo | null>(null)
  const catalogRequestRef = useRef(0)
  const issueRequestRef = useRef(0)
  const supabaseUsageRequestRef = useRef(0)
  const linkedKeys = useMemo(
    () => new Set(linkedIssueKeys.map(key => key.trim().toUpperCase())),
    [linkedIssueKeys]
  )

  const selectedCatalogItem = useMemo(
    () => catalog.find(item => sprintSelectionValue(item) === sprintSelection) ?? null,
    [catalog, sprintSelection]
  )
  const selectedSprint = selectedCatalogItem?.sprint ?? null
  const selectedBoard = selectedCatalogItem?.board ?? null
  const isPastSprint = selectedSprint?.state === 'closed'
  const isReadOnly = isPastSprint || !canEdit || compact

  useEffect(() => {
    if (!jiraStatus?.configured || !projectKeys.length) return
    const requestId = ++catalogRequestRef.current
    setLoadingCatalog(true)
    setError(null)
    void (async () => {
      const boardResults = await Promise.allSettled(
        projectKeys.map(projectKey => window.hrs.getJiraBoards(projectKey))
      )
      const boards = Array.from(
        new Map(
          boardResults
            .filter(
              (result): result is PromiseFulfilledResult<JiraAgileBoard[]> =>
                result.status === 'fulfilled'
            )
            .flatMap(result => result.value)
            .map(board => [board.id, board])
        ).values()
      )
      if (!boards.length) throw new Error('No Jira Scrum boards are available.')
      const sprintResults = await Promise.allSettled(
        boards.map(async board => ({ board, sprints: await window.hrs.getJiraSprints(board.id) }))
      )
      const items = sprintResults
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<{ board: JiraAgileBoard; sprints: JiraSprint[] }> =>
            result.status === 'fulfilled'
        )
        .flatMap(result =>
          result.value.sprints
            .filter(sprint => sprint.state === 'active' || sprint.state === 'closed')
            .map(sprint => ({ board: result.value.board, sprint }))
        )
      const uniqueItems = Array.from(
        new Map(items.map(item => [item.sprint.id, item])).values()
      ).sort((left, right) => {
        if (left.sprint.state !== right.sprint.state) {
          return left.sprint.state === 'active' ? -1 : 1
        }
        return sprintTimestamp(right.sprint) - sprintTimestamp(left.sprint)
      })
      if (requestId !== catalogRequestRef.current) return
      setCatalog(uniqueItems)
      const saved = localStorage.getItem('hrs-sprint-selection')
      setSprintSelection(current => {
        const preferred =
          uniqueItems.find(item => sprintSelectionValue(item) === current) ??
          uniqueItems.find(item => sprintSelectionValue(item) === saved) ??
          uniqueItems.find(item => item.sprint.state === 'active') ??
          uniqueItems[0]
        const nextSelection = preferred ? sprintSelectionValue(preferred) : null
        const cache = readSprintBoardCache()
        writeSprintBoardCache({
          catalog: uniqueItems,
          sprintSelection: nextSelection,
          views: cache.views
        })
        return nextSelection
      })
      if (!uniqueItems.length) setError('No active or past Jira sprints were found.')
    })()
      .catch(reason => {
        if (requestId === catalogRequestRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (requestId === catalogRequestRef.current) setLoadingCatalog(false)
      })
  }, [jiraStatus?.configured, projectKeys, catalogRefreshTick])

  useEffect(() => {
    if (!jiraStatus?.configured) return
    const intervalId = window.setInterval(() => {
      setCatalogRefreshTick(value => value + 1)
    }, 5 * 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [jiraStatus?.configured])

  async function loadSupabaseUsage(
    issues: JiraSprintIssue[],
    sprint: JiraSprint,
    issueRequestId: number,
    selectionKey: string,
    cachedBacklogIssues: JiraSprintIssue[],
    cachedSprintIssues: JiraSprintIssue[]
  ) {
    const requestId = ++supabaseUsageRequestRef.current
    setSupabaseUsageError(null)
    if (!issues.length) {
      setLoadingSupabaseUsage(false)
      return null
    }
    setLoadingSupabaseUsage(true)
    try {
      const keys = issues.map(issue => issue.key)
      const range = sprintUsageRange(sprint)
      const chunks: string[][] = []
      for (let index = 0; index < keys.length; index += 300) {
        chunks.push(keys.slice(index, index + 300))
      }
      const results = (
        await Promise.all(
          chunks.map(chunk =>
            window.hrs.getSupabaseSprintTaskUsage(chunk, range.start, range.end)
          )
        )
      ).flat()
      if (
        requestId !== supabaseUsageRequestRef.current ||
        issueRequestId !== issueRequestRef.current
      ) {
        return
      }
      const nextUsage = Object.fromEntries(results.map(usage => [usage.issueKey, usage]))
      setSupabaseUsage(nextUsage)
      const cache = readSprintBoardCache()
      writeSprintBoardCache({
        ...cache,
        sprintSelection: selectionKey,
        views: {
          ...cache.views,
          [selectionKey]: {
            backlogIssues: cachedBacklogIssues,
            sprintIssues: cachedSprintIssues,
            supabaseUsage: nextUsage,
            savedAt: new Date().toISOString()
          }
        }
      })
      return nextUsage
    } catch (reason) {
      if (
        requestId === supabaseUsageRequestRef.current &&
        issueRequestId === issueRequestRef.current
      ) {
        setSupabaseUsageError(
          `Supabase task hours could not be loaded: ${
            reason instanceof Error ? reason.message : String(reason)
          }`
        )
      }
    } finally {
      if (requestId === supabaseUsageRequestRef.current) setLoadingSupabaseUsage(false)
    }
    return null
  }

  async function refreshIssues(options: { quiet?: boolean } = {}) {
    if (!selectedBoard || !selectedSprint || !sprintSelection) return
    const requestId = ++issueRequestRef.current
    if (!options.quiet) setLoadingIssues(true)
    setError(null)
    try {
      const [backlog, sprint] = await Promise.all([
        selectedSprint.state === 'active'
          ? window.hrs.getJiraBacklogIssues(selectedBoard.id)
          : Promise.resolve([]),
        window.hrs.getJiraSprintIssues(selectedBoard.id, selectedSprint.id)
      ])
      if (requestId !== issueRequestRef.current) return
      setBacklogIssues(backlog)
      setSprintIssues(sprint)
      const cache = readSprintBoardCache()
      const previousUsage = cache.views[sprintSelection]?.supabaseUsage ?? supabaseUsage
      writeSprintBoardCache({
        ...cache,
        sprintSelection,
        views: {
          ...cache.views,
          [sprintSelection]: {
            backlogIssues: backlog,
            sprintIssues: sprint,
            supabaseUsage: previousUsage,
            savedAt: new Date().toISOString()
          }
        }
      })
      void loadSupabaseUsage(
        [...backlog, ...sprint],
        selectedSprint,
        requestId,
        sprintSelection,
        backlog,
        sprint
      )
    } catch (reason) {
      if (requestId === issueRequestRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (requestId === issueRequestRef.current && !options.quiet) setLoadingIssues(false)
    }
  }

  useEffect(() => {
    if (!sprintSelection || !selectedCatalogItem) return
    localStorage.setItem('hrs-sprint-selection', sprintSelection)
    setSuccess(null)
    setUndoAction(null)
    const cachedView = readSprintBoardCache().views[sprintSelection]
    if (cachedView) {
      setBacklogIssues(cachedView.backlogIssues)
      setSprintIssues(cachedView.sprintIssues)
      setSupabaseUsage(cachedView.supabaseUsage)
    } else {
      setBacklogIssues([])
      setSprintIssues([])
      setSupabaseUsage({})
    }
    void refreshIssues({ quiet: Boolean(cachedView) })
  }, [sprintSelection, selectedCatalogItem, supabaseConnected])

  useEffect(() => {
    if (!selectedCatalogItem) return
    const intervalId = window.setInterval(() => {
      void refreshIssues({ quiet: true })
    }, 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [selectedCatalogItem, supabaseConnected])

  const issuesByColumn = useMemo<Record<SprintColumn, JiraSprintIssue[]>>(
    () => ({
      backlog: backlogIssues,
      todo: sprintIssues.filter(issue => issue.statusCategoryKey === 'todo'),
      indeterminate: sprintIssues.filter(issue => issue.statusCategoryKey === 'indeterminate'),
      done: sprintIssues.filter(issue => issue.statusCategoryKey === 'done')
    }),
    [backlogIssues, sprintIssues]
  )
  const reporterOptions = useMemo(() => {
    const reporters = new Map<number, { employeeName: string; seconds: number }>()
    const visibleIssueKeys = new Set([...backlogIssues, ...sprintIssues].map(issue => issue.key))
    for (const [issueKey, usage] of Object.entries(supabaseUsage)) {
      if (!visibleIssueKeys.has(issueKey)) continue
      for (const employee of usage.employees) {
        const existing = reporters.get(employee.employeeId)
        reporters.set(employee.employeeId, {
          employeeName: employee.employeeName,
          seconds: (existing?.seconds ?? 0) + employee.seconds
        })
      }
    }
    return Array.from(reporters.entries())
      .map(([employeeId, reporter]) => ({
        value: String(employeeId),
        label: `${reporter.employeeName} · ${formatSeconds(reporter.seconds)}`,
        employeeName: reporter.employeeName
      }))
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName))
  }, [backlogIssues, sprintIssues, supabaseUsage])
  const filteredIssuesByColumn = useMemo<Record<SprintColumn, JiraSprintIssue[]>>(() => {
    if (!reporterFilter) return issuesByColumn
    const employeeId = Number(reporterFilter)
    const matchesReporter = (issue: JiraSprintIssue) =>
      supabaseUsage[issue.key]?.employees.some(employee => employee.employeeId === employeeId) ??
      false
    return {
      backlog: issuesByColumn.backlog.filter(matchesReporter),
      todo: issuesByColumn.todo.filter(matchesReporter),
      indeterminate: issuesByColumn.indeterminate.filter(matchesReporter),
      done: issuesByColumn.done.filter(matchesReporter)
    }
  }, [issuesByColumn, reporterFilter, supabaseUsage])

  useEffect(() => {
    if (!sprintSelection) {
      setReporterFilter(null)
      return
    }
    setReporterFilter(localStorage.getItem(`hrs-sprint-reporter:${sprintSelection}`))
  }, [sprintSelection])

  useEffect(() => {
    if (!reporterFilter || !reporterOptions.length) return
    if (reporterOptions.some(option => option.value === reporterFilter)) return
    setReporterFilter(null)
  }, [reporterFilter, reporterOptions])

  function changeReporterFilter(value: string | null) {
    setReporterFilter(value)
    if (!sprintSelection) return
    if (value) localStorage.setItem(`hrs-sprint-reporter:${sprintSelection}`, value)
    else localStorage.removeItem(`hrs-sprint-reporter:${sprintSelection}`)
  }
  const sprintHourTotals = useMemo(() => {
    return sprintIssues.reduce(
      (totals, issue) => {
        const usage = supabaseUsage[issue.key]
        totals.usedSeconds += usage?.usedSeconds ?? 0
        totals.budgetSeconds += usage?.budgetSeconds ?? issue.estimateSeconds ?? 0
        return totals
      },
      { usedSeconds: 0, budgetSeconds: 0 }
    )
  }, [sprintIssues, supabaseUsage])
  const remainingSprintDays = selectedSprint ? getRemainingSprintDays(selectedSprint) : null
  const visibleColumns: SprintColumn[] = isPastSprint
    ? ['todo', 'indeterminate', 'done']
    : ['backlog', 'todo', 'indeterminate', 'done']
  const displayedColumns = compact ? [compactColumn] : visibleColumns

  useEffect(() => {
    if (!compact) return
    if (isPastSprint && compactColumn === 'backlog') setCompactColumn('done')
  }, [compact, isPastSprint, compactColumn])

  async function transitionToColumn(issueKey: string, column: Exclude<SprintColumn, 'backlog'>) {
    const transitions = await window.hrs.getJiraTransitions(issueKey)
    const transition = transitions.find(
      item => categoryForStatusName(item.toStatusName) === column
    )
    if (!transition) throw new Error(`No Jira transition is available for ${COLUMN_LABELS[column]}.`)
    await window.hrs.transitionJiraSprintIssue({ issueKey, transitionId: transition.id })
  }

  function optimisticallyMove(issue: JiraSprintIssue, target: SprintColumn) {
    setBacklogIssues(previous => previous.filter(item => item.key !== issue.key))
    setSprintIssues(previous => {
      const withoutIssue = previous.filter(item => item.key !== issue.key)
      if (target === 'backlog') return withoutIssue
      return [
        ...withoutIssue,
        { ...issue, statusCategoryKey: target, statusName: statusNameForColumn(target) }
      ]
    })
    if (target === 'backlog') setBacklogIssues(previous => [...previous, issue])
  }

  async function moveIssue(issueKey: string, source: SprintColumn, target: SprintColumn) {
    if (
      source === target ||
      mutationLoading ||
      !canEdit ||
      !selectedSprint ||
      selectedSprint.state !== 'active'
    ) return
    const issue = [...backlogIssues, ...sprintIssues].find(item => item.key === issueKey)
    if (!issue) return
    const previousBacklog = backlogIssues
    const previousSprint = sprintIssues
    setMutationLoading(true)
    setError(null)
    setSuccess(null)
    setUndoAction(null)
    optimisticallyMove(issue, target)
    try {
      if (target === 'backlog') {
        await window.hrs.moveJiraIssuesToBacklog([issue.key])
      } else {
        if (source === 'backlog') {
          await window.hrs.moveJiraIssuesToSprint({
            sprintId: selectedSprint.id,
            issueKeys: [issue.key]
          })
        }
        if (issue.statusCategoryKey !== target) await transitionToColumn(issue.key, target)
      }
      setSuccess(`${issue.key} moved from ${COLUMN_LABELS[source]} to ${COLUMN_LABELS[target]}.`)
      setUndoAction({
        label: `Undo ${issue.key} move`,
        run: async () => {
          if (source === 'backlog') {
            if (target !== 'backlog' && issue.statusCategoryKey !== target) {
              await transitionToColumn(issue.key, issue.statusCategoryKey)
            }
            await window.hrs.moveJiraIssuesToBacklog([issue.key])
          } else {
            await window.hrs.moveJiraIssuesToSprint({
              sprintId: selectedSprint.id,
              issueKeys: [issue.key]
            })
            if (target !== 'backlog' && issue.statusCategoryKey !== target) {
              await transitionToColumn(issue.key, issue.statusCategoryKey)
            }
          }
        }
      })
      await refreshIssues({ quiet: true })
    } catch (reason) {
      setBacklogIssues(previousBacklog)
      setSprintIssues(previousSprint)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setMutationLoading(false)
      setDragState(null)
      setDragOverColumn(null)
    }
  }

  async function rankIssue(issueKey: string, targetIssueKey: string, column: SprintColumn) {
    if (
      issueKey === targetIssueKey ||
      mutationLoading ||
      !canEdit ||
      !selectedSprint ||
      selectedSprint.state !== 'active'
    ) return
    const items = issuesByColumn[column]
    const originalIndex = items.findIndex(issue => issue.key === issueKey)
    const targetIndex = items.findIndex(issue => issue.key === targetIssueKey)
    if (originalIndex < 0 || targetIndex < 0) return
    const originalPrevious = items[originalIndex - 1]?.key ?? null
    const originalNext = items[originalIndex + 1]?.key ?? null
    const reordered = [...items]
    const [moved] = reordered.splice(originalIndex, 1)
    const adjustedTarget = reordered.findIndex(issue => issue.key === targetIssueKey)
    reordered.splice(Math.max(0, adjustedTarget), 0, moved)
    if (column === 'backlog') {
      setBacklogIssues(reordered)
    } else {
      const keys = new Set(reordered.map(issue => issue.key))
      setSprintIssues([...sprintIssues.filter(issue => !keys.has(issue.key)), ...reordered])
    }
    setMutationLoading(true)
    setError(null)
    try {
      await window.hrs.rankJiraIssues({ issueKeys: [issueKey], rankBeforeIssue: targetIssueKey })
      setSuccess(`${issueKey} reordered in ${COLUMN_LABELS[column]}.`)
      setUndoAction({
        label: `Undo ${issueKey} reorder`,
        run: async () => {
          await window.hrs.rankJiraIssues({
            issueKeys: [issueKey],
            ...(originalNext
              ? { rankBeforeIssue: originalNext }
              : originalPrevious
                ? { rankAfterIssue: originalPrevious }
                : { rankBeforeIssue: targetIssueKey })
          })
        }
      })
      await refreshIssues({ quiet: true })
    } catch (reason) {
      await refreshIssues({ quiet: true })
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setMutationLoading(false)
      setDragState(null)
      setDragOverColumn(null)
    }
  }

  async function undoLastAction() {
    if (!undoAction || mutationLoading) return
    setMutationLoading(true)
    setError(null)
    try {
      await undoAction.run()
      setSuccess(`${undoAction.label} completed.`)
      setUndoAction(null)
      await refreshIssues({ quiet: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setMutationLoading(false)
    }
  }

  function handleColumnDrop(event: ReactDragEvent, target: SprintColumn) {
    event.preventDefault()
    if (!dragState || isReadOnly) return
    void moveIssue(dragState.issueKey, dragState.source, target)
  }

  async function startEmployeeWork(issue: JiraSprintIssue) {
    if (isPastSprint || issue.statusCategoryKey !== 'todo') return
    setStartLoadingKey(issue.key)
    setError(null)
    try {
      await window.hrs.startJiraSprintIssue(issue.key)
      setSprintIssues(previous =>
        previous.map(item =>
          item.key === issue.key
            ? { ...item, statusName: 'In Progress', statusCategoryKey: 'indeterminate' }
            : item
        )
      )
      setSuccess(`${issue.key} moved to In Progress.`)
      await refreshIssues({ quiet: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setStartLoadingKey(null)
    }
  }

  async function toggleEmployeeCompletion(issue: JiraSprintIssue, usage: SupabaseSprintTaskUsage) {
    if (!selectedSprint || !sprintSelection || isPastSprint || issue.statusCategoryKey === 'done') {
      return
    }
    const reporter = usage.employees.find(employee => employee.employeeId === currentEmployeeId)
    if (!reporter) return
    const nextCompleted = !reporter.completedAt
    setCompletionLoadingKey(issue.key)
    setError(null)
    try {
      await window.hrs.setSupabaseSprintTaskCompletion(usage.taskId, nextCompleted)
      const updatedUsage = await loadSupabaseUsage(
        [...backlogIssues, ...sprintIssues],
        selectedSprint,
        issueRequestRef.current,
        sprintSelection,
        backlogIssues,
        sprintIssues
      )
      const nextTaskUsage = updatedUsage?.[issue.key]
      const consensusReached = Boolean(
        nextCompleted &&
          nextTaskUsage &&
          nextTaskUsage.completionRequiredCount > 0 &&
          nextTaskUsage.completionCount >= nextTaskUsage.completionRequiredCount
      )
      if (consensusReached) {
        await window.hrs.completeJiraSprintIssueByConsensus({
          issueKey: issue.key,
          taskId: usage.taskId
        })
        setSuccess(`${issue.key} moved to Done after every reporter confirmed completion.`)
        await refreshIssues({ quiet: true })
      } else {
        setSuccess(
          nextCompleted
            ? `${currentEmployeeName || 'You'} marked ${issue.key} done.`
            : `${currentEmployeeName || 'Your'} completion confirmation was removed.`
        )
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCompletionLoadingKey(null)
    }
  }

  async function toggleIssueDetails(issueKey: string) {
    if (expandedIssueKey === issueKey) {
      setExpandedIssueKey(null)
      return
    }
    setExpandedIssueKey(issueKey)
    if (detailsByIssue[issueKey] || detailsLoadingKey === issueKey) return
    setDetailsLoadingKey(issueKey)
    setDetailsErrorByIssue(previous => {
      const next = { ...previous }
      delete next[issueKey]
      return next
    })
    try {
      const details = await window.hrs.getJiraSprintIssueDetails(issueKey)
      setDetailsByIssue(previous => ({ ...previous, [issueKey]: details }))
    } catch (reason) {
      setDetailsErrorByIssue(previous => ({
        ...previous,
        [issueKey]: reason instanceof Error ? reason.message : String(reason)
      }))
    } finally {
      setDetailsLoadingKey(current => (current === issueKey ? null : current))
    }
  }

  function renderIssueCard(issue: JiraSprintIssue, column: SprintColumn) {
    const linked = linkedKeys.has(issue.key.toUpperCase())
    const usage = supabaseUsage[issue.key]
    const loggedSeconds = usage?.usedSeconds ?? 0
    const budgetSeconds = usage?.budgetSeconds ?? issue.estimateSeconds
    const remainingSeconds = Math.max(0, budgetSeconds - loggedSeconds)
    const currentReporter = usage?.employees.find(
      employee => employee.employeeId === currentEmployeeId
    )
    const details = detailsByIssue[issue.key]
    const detailsExpanded = expandedIssueKey === issue.key
    return (
      <Card
        key={issue.key}
        data-issue-key={issue.key}
        data-column={column}
        withBorder
        radius="md"
        className={`sprint-issue-card${dragState?.issueKey === issue.key ? ' is-dragging' : ''}`}
        draggable={!mutationLoading && !isReadOnly}
        onDragStart={event => {
          if (isReadOnly) return
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', issue.key)
          setDragState({ issueKey: issue.key, source: column })
        }}
        onDragEnd={() => {
          setDragState(null)
          setDragOverColumn(null)
        }}
        onDragOver={event => {
          if (isReadOnly) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={event => {
          event.preventDefault()
          event.stopPropagation()
          if (!dragState || isReadOnly) return
          if (dragState.source === column) void rankIssue(dragState.issueKey, issue.key, column)
          else void moveIssue(dragState.issueKey, dragState.source, column)
        }}
      >
        <Stack gap={8}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              {!isReadOnly ? <IconGripVertical size={15} className="sprint-card-grip" /> : null}
              <Text size="xs" fw={800} className="sprint-issue-key">
                {issue.key}
              </Text>
            </Group>
            {linked ? <Badge size="xs" variant="light" color="cyan">HRS linked</Badge> : null}
          </Group>
          <Text size="sm" fw={700} lineClamp={2} className="sprint-issue-summary">
            {issue.summary}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            Assigned to {issue.assigneeName || 'Unassigned'}
          </Text>

          <div className="sprint-worklog-section">
            <Group justify="space-between" align="center" mb={5} wrap="nowrap">
              <Group gap={5} wrap="nowrap">
                <IconUsers size={13} />
                <Text size="xs" fw={800}>Supabase reported hours</Text>
                {loadingSupabaseUsage && !usage ? <Loader size={11} /> : null}
              </Group>
              {usage?.completionAvailable && usage.completionRequiredCount > 0 ? (
                <Badge size="xs" variant="light" color="teal">
                  {usage.completionCount}/{usage.completionRequiredCount} done
                </Badge>
              ) : null}
            </Group>
            {usage?.employees.length ? (
              <Stack gap={4}>
                {usage.employees.map(employee => (
                  <Group
                    key={`${issue.key}:${employee.employeeId}`}
                    justify="space-between"
                    align="center"
                    wrap="nowrap"
                    className="sprint-contributor-row"
                    aria-label={`${employee.employeeName} reported ${formatSeconds(employee.seconds)} from Supabase`}
                  >
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <span className="sprint-contributor-avatar" aria-hidden="true">
                        {employee.employeeName.trim().charAt(0).toUpperCase() || '?'}
                      </span>
                      <Text size="xs" truncate>{employee.employeeName}</Text>
                    </Group>
                    <Stack gap={1} align="flex-end" className="sprint-contributor-completion">
                      <Text size="xs" fw={800} className="sprint-contributor-hours">
                        {formatSeconds(employee.seconds)}
                      </Text>
                      {employee.completedAt ? (
                        <Text size="xs" c="teal">
                          Done {formatCompletionDate(employee.completedAt)}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">Not confirmed</Text>
                      )}
                    </Stack>
                  </Group>
                ))}
              </Stack>
            ) : loadingSupabaseUsage && !usage ? (
              <Text size="xs" c="dimmed">Loading Supabase contributors…</Text>
            ) : !supabaseConnected ? (
              <Text size="xs" c="dimmed">Connect Supabase to see reported hours</Text>
            ) : !usage ? (
              <Text size="xs" c="dimmed">Not linked to a Supabase shared task</Text>
            ) : (
              <Text size="xs" c="dimmed">No reported hours</Text>
            )}
          </div>

          {usage ? (
            <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
              <Tooltip
                label={`${formatSeconds(budgetSeconds)} ${usage.budgetSeconds !== null ? 'Supabase task budget' : 'Jira original estimate'}`}
                withArrow
              >
                <Group gap={4} wrap="nowrap" className="sprint-card-time">
                  <IconClock size={12} />
                  <Text size="xs">Logged {formatSeconds(loggedSeconds)}</Text>
                </Group>
              </Tooltip>
              <Badge size="sm" variant="light" color={remainingSeconds > 0 ? 'yellow' : 'teal'}>
                {formatSeconds(remainingSeconds)} remaining
              </Badge>
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              Supabase totals unavailable
            </Text>
          )}

          <Group justify="space-between" align="center" gap={6} wrap="wrap" className="sprint-card-actions">
            <Group gap={5} wrap="wrap">
              {!isPastSprint && issue.statusCategoryKey === 'todo' ? (
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconPlayerPlay size={13} />}
                  loading={startLoadingKey === issue.key}
                  onClick={() => void startEmployeeWork(issue)}
                >
                  Start work
                </Button>
              ) : null}
              {!isPastSprint &&
              issue.statusCategoryKey !== 'done' &&
              usage?.completionAvailable &&
              currentReporter ? (
                <Button
                  size="compact-xs"
                  variant={currentReporter.completedAt ? 'filled' : 'light'}
                  color="teal"
                  leftSection={<IconCircleCheck size={13} />}
                  loading={completionLoadingKey === issue.key}
                  onClick={() => void toggleEmployeeCompletion(issue, usage)}
                >
                  {currentReporter.completedAt ? 'Done confirmed' : 'Mark done'}
                </Button>
              ) : null}
            </Group>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconMessageCircle size={13} />}
              rightSection={
                detailsExpanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />
              }
              aria-expanded={detailsExpanded}
              onClick={() => void toggleIssueDetails(issue.key)}
            >
              Details
            </Button>
          </Group>

          {!isPastSprint &&
          usage?.completionAvailable &&
          usage.employees.length > 0 &&
          !currentReporter &&
          issue.statusCategoryKey !== 'done' ? (
            <Text size="xs" c="dimmed">
              Report hours on this task before confirming completion.
            </Text>
          ) : null}

          {!usage?.completionAvailable && usage ? (
            <Text size="xs" c="yellow">
              Apply Supabase migration 005 to enable shared completion confirmations.
            </Text>
          ) : null}

          <Collapse in={detailsExpanded} transitionDuration={180}>
            <div className="sprint-issue-details">
              {detailsLoadingKey === issue.key ? (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed">Loading Jira details…</Text>
                </Group>
              ) : detailsErrorByIssue[issue.key] ? (
                <Text size="xs" c="red">{detailsErrorByIssue[issue.key]}</Text>
              ) : details ? (
                <Stack gap="sm">
                  <div>
                    <Text size="xs" fw={800}>Description</Text>
                    <Text size="xs" c="dimmed" className="sprint-detail-description">
                      {details.description || 'No Jira description.'}
                    </Text>
                  </div>
                  <div>
                    <Group gap={5} mb={5}>
                      <IconPaperclip size={13} />
                      <Text size="xs" fw={800}>Attachments · {details.attachments.length}</Text>
                    </Group>
                    {details.attachments.length ? (
                      <div className="sprint-detail-attachments">
                        {details.attachments.map(attachment => (
                          <button
                            key={attachment.id}
                            type="button"
                            className="sprint-detail-attachment"
                            aria-label={`Open Jira attachment ${attachment.name}`}
                            onClick={() =>
                              void window.hrs.openJiraAttachment({
                                id: attachment.id,
                                filename: attachment.name
                              })
                            }
                          >
                            {attachment.previewDataUrl ? (
                              <img src={attachment.previewDataUrl} alt="" />
                            ) : (
                              <IconPaperclip size={18} />
                            )}
                            <span>{attachment.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Text size="xs" c="dimmed">No attachments.</Text>
                    )}
                  </div>
                  <div>
                    <Group gap={5} mb={5}>
                      <IconMessageCircle size={13} />
                      <Text size="xs" fw={800}>Comments · {details.comments.length}</Text>
                    </Group>
                    {details.comments.length ? (
                      <Stack gap={5}>
                        {details.comments.map(comment => (
                          <div key={comment.id} className="sprint-detail-comment">
                            <Group justify="space-between" gap={6} wrap="nowrap">
                              <Text size="xs" fw={800} truncate>{comment.authorName}</Text>
                              <Text size="xs" c="dimmed">
                                {formatCompletionDate(comment.createdAt)}
                              </Text>
                            </Group>
                            <Text size="xs" className="sprint-detail-comment-text">
                              {comment.text || 'Attachment'}
                            </Text>
                          </div>
                        ))}
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed">No comments.</Text>
                    )}
                  </div>
                </Stack>
              ) : null}
            </div>
          </Collapse>
        </Stack>
      </Card>
    )
  }

  const closeButton = compact ? null : (
    <Tooltip label="Close" withArrow>
      <ActionIcon
        className="sprint-close-button"
        size="lg"
        radius="xl"
        variant="subtle"
        aria-label="Close Sprint Board"
        title="Close Sprint Board"
        onClick={onClose}
      >
        <IconX size={22} />
      </ActionIcon>
    </Tooltip>
  )

  if (!jiraStatus?.configured) {
    return (
      <>
        {closeButton}
        <Card
          withBorder
          radius="lg"
          className={`sprint-empty-state${compact ? ' is-compact' : ''}`}
        >
          <Stack align="center" gap="sm">
            <IconRoute size={36} />
            <Text fw={800}>Connect Jira to manage sprints</Text>
            <Text size="sm" c="dimmed" ta="center">
              Connect Jira from HRS Desktop settings, then reopen the Sprint Board.
            </Text>
          </Stack>
        </Card>
      </>
    )
  }

  return (
    <Stack gap={compact ? 'xs' : 'md'} className={`sprint-board-root${compact ? ' is-compact' : ''}`}>
      {closeButton}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap={5}>
          <Group gap="xs">
            <IconRoute size={22} />
            <Text fw={900} size={compact ? 'md' : 'xl'}>Jira Sprint Board</Text>
          </Group>
          <Text size="sm" c="dimmed">
            {compact
              ? canEdit
                ? 'Review the sprint here, or expand the board to edit Jira cards.'
                : 'Review the sprint and Supabase hours in this read-only view.'
              : isPastSprint
              ? 'Review completed sprint issues and the hours reported by every contributor.'
              : canEdit
                ? 'Drag Jira issues between backlog and sprint statuses. Every drop is saved to Jira.'
                : 'Review the live sprint and Supabase hours. Only managers can edit the board.'}
          </Text>
        </Stack>
        <Group gap="xs" className="sprint-header-actions">
          {mutationLoading ? <Loader size="sm" /> : null}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={!compact && loadingIssues}
            disabled={!selectedCatalogItem}
            onClick={() => void refreshIssues()}
          >
            Refresh
          </Button>
          {compact && onExpand ? (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconArrowsMaximize size={14} />}
              onClick={onExpand}
            >
              Expand
            </Button>
          ) : null}
        </Group>
      </Group>

      <Card withBorder radius="lg" className="sprint-board-toolbar">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select
            label="Sprint"
            placeholder="Choose a sprint"
            data={catalog.map(item => ({
              value: sprintSelectionValue(item),
              label: `${item.sprint.state === 'active' ? 'Active' : 'Past'} · ${item.sprint.name}`
            }))}
            value={sprintSelection}
            onChange={setSprintSelection}
            searchable
            disabled={!catalog.length}
            rightSection={!compact && loadingCatalog && !catalog.length ? <Loader size={14} /> : undefined}
            className="sprint-only-select"
          />
          <Select
            label="Reporter"
            placeholder="All reporters"
            data={reporterOptions.map(option => ({
              value: option.value,
              label: option.label
            }))}
            value={reporterFilter}
            onChange={changeReporterFilter}
            searchable
            clearable
            disabled={!reporterOptions.length}
            nothingFoundMessage="No Supabase reporters"
            className="sprint-reporter-select"
          />
          {selectedSprint ? (
            <Stack gap={3} className="sprint-goal-copy">
              <Badge size="xs" color={isPastSprint ? 'gray' : 'teal'}>
                {isPastSprint
                  ? 'Past sprint · Read only'
                  : canEdit
                    ? compact
                      ? 'Manager view · Expand to edit'
                      : 'Manager editing'
                    : 'Employee view · Read only'}
              </Badge>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {selectedSprint.goal || 'No sprint goal'}
              </Text>
              <Group gap={6} wrap="wrap" className="sprint-date-range">
                <Badge
                  size="sm"
                  variant="light"
                  color="blue"
                  leftSection={<IconCalendarEvent size={12} />}
                >
                  Start {formatSprintDate(selectedSprint.startDate)}
                </Badge>
                <Badge
                  size="sm"
                  variant="light"
                  color={isPastSprint ? 'gray' : 'cyan'}
                  leftSection={<IconCalendarEvent size={12} />}
                >
                  End {formatSprintDate(selectedSprint.endDate)}
                </Badge>
                <Badge
                  size="sm"
                  variant="light"
                  color={remainingSprintDays && remainingSprintDays > 0 ? 'yellow' : 'gray'}
                  leftSection={<IconClock size={12} />}
                >
                  {remainingSprintDays === null
                    ? 'Remaining days not set'
                    : `${remainingSprintDays} day${remainingSprintDays === 1 ? '' : 's'} remaining`}
                </Badge>
                <Badge
                  size="sm"
                  variant="light"
                  color="teal"
                  leftSection={<IconClock size={12} />}
                >
                  Mission hours {formatSeconds(sprintHourTotals.usedSeconds)} used /{' '}
                  {sprintHourTotals.budgetSeconds > 0
                    ? formatSeconds(sprintHourTotals.budgetSeconds)
                    : 'No budget'}
                </Badge>
              </Group>
            </Stack>
          ) : null}
        </Group>
      </Card>

      {error ? <Alert color="red" variant="light" radius="md">{error}</Alert> : null}
      {supabaseUsageError ? (
        <Alert color="yellow" variant="light" radius="md">{supabaseUsageError}</Alert>
      ) : null}
      {success ? (
        <Alert color="teal" variant="light" radius="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm">{success}</Text>
            {undoAction ? (
              <Button
                size="compact-xs"
                variant="subtle"
                aria-label={undoAction.label}
                title={undoAction.label}
                leftSection={<IconArrowBackUp size={13} />}
                onClick={() => void undoLastAction()}
                loading={mutationLoading}
              >
                Undo
              </Button>
            ) : null}
          </Group>
        </Alert>
      ) : null}

      {compact ? (
        <SegmentedControl
          fullWidth
          size="xs"
          value={compactColumn}
          onChange={value => setCompactColumn(value as SprintColumn)}
          data={visibleColumns.map(column => ({
            value: column,
            label: `${COLUMN_LABELS[column]} ${filteredIssuesByColumn[column].length}`
          }))}
          className="sprint-compact-columns-switcher"
        />
      ) : null}

      <div
        className={`sprint-board-columns${isPastSprint ? ' is-past' : ''}${compact ? ' is-compact' : ''}`}
        aria-busy={loadingIssues || mutationLoading}
      >
        {displayedColumns.map(column => {
          const issues = filteredIssuesByColumn[column]
          return (
            <section
              key={column}
              data-sprint-column={column}
              className={[
                'sprint-column',
                `is-${column}`,
                dragOverColumn === column ? 'is-drag-over' : ''
              ].join(' ').trim()}
              onDragEnter={event => {
                if (isReadOnly) return
                event.preventDefault()
                setDragOverColumn(column)
              }}
              onDragOver={event => {
                if (isReadOnly) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragOverColumn(current => (current === column ? null : current))
                }
              }}
              onDrop={event => handleColumnDrop(event, column)}
            >
              <Group justify="space-between" align="center" className="sprint-column-header">
                <Text fw={800} size="sm">{COLUMN_LABELS[column]}</Text>
                <Badge size="xs" variant="light">{issues.length}</Badge>
              </Group>
              <Stack gap="xs" className="sprint-column-list">
                {issues.map(issue => renderIssueCard(issue, column))}
                {!issues.length ? (
                  <div className="sprint-column-empty">
                    <Text size="xs" c="dimmed" ta="center">
                      {isPastSprint ? 'No issues' : 'Drop issues here'}
                    </Text>
                  </div>
                ) : null}
              </Stack>
            </section>
          )
        })}
      </div>

      <Text size="xs" c="dimmed" ta="center">
        {compact
          ? canEdit
            ? 'Expand the board to move and rank Jira cards.'
            : 'Employee access is read-only.'
          : isPastSprint
          ? 'Past sprints are read-only. Contributor totals come from Supabase reports.'
          : canEdit
            ? 'Manager access enabled. Moving and ranking issues is saved to Jira.'
            : 'Employee access is read-only. Ask a manager to update sprint status or ranking.'}
      </Text>
    </Stack>
  )
}
