import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import {
  IconArrowBackUp,
  IconClock,
  IconGripVertical,
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

type Props = {
  jiraStatus: SprintProjectStatus | null
  linkedIssueKeys: string[]
  supabaseConnected: boolean
  onClose: () => void
}

const COLUMN_LABELS: Record<SprintColumn, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  indeterminate: 'In Progress',
  done: 'Done'
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

export function SprintBoard({ jiraStatus, linkedIssueKeys, supabaseConnected, onClose }: Props) {
  const projectKeys = useMemo(() => {
    const values = jiraStatus?.projectKeys?.length
      ? jiraStatus.projectKeys
      : jiraStatus?.projectKey
        ? [jiraStatus.projectKey]
        : ['VDA', 'LSM']
    return Array.from(new Set(values.map(value => value.trim().toUpperCase()).filter(Boolean)))
  }, [jiraStatus])
  const [catalog, setCatalog] = useState<SprintCatalogItem[]>([])
  const [sprintSelection, setSprintSelection] = useState<string | null>(null)
  const [backlogIssues, setBacklogIssues] = useState<JiraSprintIssue[]>([])
  const [sprintIssues, setSprintIssues] = useState<JiraSprintIssue[]>([])
  const [supabaseUsage, setSupabaseUsage] = useState<
    Record<string, SupabaseSprintTaskUsage>
  >({})
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [loadingSupabaseUsage, setLoadingSupabaseUsage] = useState(false)
  const [mutationLoading, setMutationLoading] = useState(false)
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

  useEffect(() => {
    if (!jiraStatus?.configured || !projectKeys.length) return
    const requestId = ++catalogRequestRef.current
    setLoadingCatalog(true)
    setError(null)
    setCatalog([])
    setSprintSelection(null)
    setBacklogIssues([])
    setSprintIssues([])
    setSupabaseUsage({})
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
      const preferred =
        uniqueItems.find(item => sprintSelectionValue(item) === saved) ??
        uniqueItems.find(item => item.sprint.state === 'active') ??
        uniqueItems[0]
      setSprintSelection(preferred ? sprintSelectionValue(preferred) : null)
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
  }, [jiraStatus?.configured, projectKeys])

  async function loadSupabaseUsage(
    issues: JiraSprintIssue[],
    sprint: JiraSprint,
    issueRequestId: number
  ) {
    const requestId = ++supabaseUsageRequestRef.current
    setSupabaseUsage({})
    setSupabaseUsageError(null)
    if (!issues.length) {
      setLoadingSupabaseUsage(false)
      return
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
      setSupabaseUsage(Object.fromEntries(results.map(usage => [usage.issueKey, usage])))
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
  }

  async function refreshIssues(options: { quiet?: boolean } = {}) {
    if (!selectedBoard || !selectedSprint) return
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
      void loadSupabaseUsage([...backlog, ...sprint], selectedSprint, requestId)
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
    void refreshIssues()
  }, [sprintSelection, selectedCatalogItem, supabaseConnected])

  const issuesByColumn = useMemo<Record<SprintColumn, JiraSprintIssue[]>>(
    () => ({
      backlog: backlogIssues,
      todo: sprintIssues.filter(issue => issue.statusCategoryKey === 'todo'),
      indeterminate: sprintIssues.filter(issue => issue.statusCategoryKey === 'indeterminate'),
      done: sprintIssues.filter(issue => issue.statusCategoryKey === 'done')
    }),
    [backlogIssues, sprintIssues]
  )
  const visibleColumns: SprintColumn[] = isPastSprint
    ? ['todo', 'indeterminate', 'done']
    : ['backlog', 'todo', 'indeterminate', 'done']

  async function transitionToColumn(issueKey: string, column: Exclude<SprintColumn, 'backlog'>) {
    const transitions = await window.hrs.getJiraTransitions(issueKey)
    const transition = transitions.find(
      item => categoryForStatusName(item.toStatusName) === column
    )
    if (!transition) throw new Error(`No Jira transition is available for ${COLUMN_LABELS[column]}.`)
    await window.hrs.transitionJiraIssue({ issueKey, transitionId: transition.id })
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
    if (!dragState || isPastSprint) return
    void moveIssue(dragState.issueKey, dragState.source, target)
  }

  function renderIssueCard(issue: JiraSprintIssue, column: SprintColumn) {
    const linked = linkedKeys.has(issue.key.toUpperCase())
    const usage = supabaseUsage[issue.key]
    const loggedSeconds = usage?.usedSeconds ?? 0
    const budgetSeconds = usage?.budgetSeconds ?? issue.estimateSeconds
    const remainingSeconds = Math.max(0, budgetSeconds - loggedSeconds)
    return (
      <Card
        key={issue.key}
        data-issue-key={issue.key}
        data-column={column}
        withBorder
        radius="md"
        className={`sprint-issue-card${dragState?.issueKey === issue.key ? ' is-dragging' : ''}`}
        draggable={!mutationLoading && !isPastSprint}
        onDragStart={event => {
          if (isPastSprint) return
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', issue.key)
          setDragState({ issueKey: issue.key, source: column })
        }}
        onDragEnd={() => {
          setDragState(null)
          setDragOverColumn(null)
        }}
        onDragOver={event => {
          if (isPastSprint) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={event => {
          event.preventDefault()
          event.stopPropagation()
          if (!dragState || isPastSprint) return
          if (dragState.source === column) void rankIssue(dragState.issueKey, issue.key, column)
          else void moveIssue(dragState.issueKey, dragState.source, column)
        }}
      >
        <Stack gap={8}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              {!isPastSprint ? <IconGripVertical size={15} className="sprint-card-grip" /> : null}
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
            <Group gap={5} mb={5}>
              <IconUsers size={13} />
              <Text size="xs" fw={800}>Supabase reported hours</Text>
              {loadingSupabaseUsage && !usage ? <Loader size={11} /> : null}
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
                    <Text size="xs" fw={800} className="sprint-contributor-hours">
                      {formatSeconds(employee.seconds)}
                    </Text>
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
        </Stack>
      </Card>
    )
  }

  const closeButton = (
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
        <Card withBorder radius="lg" className="sprint-empty-state">
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
    <Stack gap="md" className="sprint-board-root">
      {closeButton}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap={5}>
          <Group gap="xs">
            <IconRoute size={22} />
            <Text fw={900} size="xl">Jira Sprint Board</Text>
          </Group>
          <Text size="sm" c="dimmed">
            {isPastSprint
              ? 'Review completed sprint issues and the hours reported by every contributor.'
              : 'Drag Jira issues between backlog and sprint statuses. Every drop is saved to Jira.'}
          </Text>
        </Stack>
        <Group gap="xs" className="sprint-header-actions">
          {mutationLoading ? <Loader size="sm" /> : null}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={loadingIssues}
            disabled={!selectedCatalogItem}
            onClick={() => void refreshIssues()}
          >
            Refresh
          </Button>
        </Group>
      </Group>

      <Card withBorder radius="lg" className="sprint-board-toolbar">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select
            label="Sprint"
            placeholder={loadingCatalog ? 'Loading active and past sprints…' : 'Choose a sprint'}
            data={catalog.map(item => ({
              value: sprintSelectionValue(item),
              label: `${item.sprint.state === 'active' ? 'Active' : 'Past'} · ${item.sprint.name}`
            }))}
            value={sprintSelection}
            onChange={setSprintSelection}
            searchable
            disabled={loadingCatalog || !catalog.length}
            rightSection={loadingCatalog ? <Loader size={14} /> : undefined}
            className="sprint-only-select"
          />
          {selectedSprint ? (
            <Stack gap={3} className="sprint-goal-copy">
              <Badge size="xs" color={isPastSprint ? 'gray' : 'teal'}>
                {isPastSprint ? 'Past sprint · Read only' : 'Active sprint'}
              </Badge>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {selectedSprint.goal || 'No sprint goal'}
              </Text>
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

      <div
        className={`sprint-board-columns${isPastSprint ? ' is-past' : ''}`}
        aria-busy={loadingIssues || mutationLoading}
      >
        {visibleColumns.map(column => {
          const issues = issuesByColumn[column]
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
                if (isPastSprint) return
                event.preventDefault()
                setDragOverColumn(column)
              }}
              onDragOver={event => {
                if (isPastSprint) return
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
        {isPastSprint
          ? 'Past sprints are read-only. Contributor totals come from Supabase reports.'
          : 'Moving and ranking issues requires Jira Edit and Schedule Issues permissions.'}
      </Text>
    </Stack>
  )
}
