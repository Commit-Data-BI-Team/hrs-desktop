import {
  Alert,
  Badge,
  Button,
  Card,
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
  IconClock,
  IconGripVertical,
  IconRefresh,
  IconRoute,
  IconSettings
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { JiraAgileBoard, JiraSprint, JiraSprintIssue } from './types/hrs'

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

type Props = {
  jiraStatus: SprintProjectStatus | null
  linkedIssueKeys: string[]
  onOpenSettings: () => void
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

export function SprintBoard({ jiraStatus, linkedIssueKeys, onOpenSettings }: Props) {
  const projectKeys = useMemo(() => {
    const values = jiraStatus?.projectKeys?.length
      ? jiraStatus.projectKeys
      : jiraStatus?.projectKey
        ? [jiraStatus.projectKey]
        : ['VDA', 'LSM']
    return Array.from(new Set(values.map(value => value.trim().toUpperCase()).filter(Boolean)))
  }, [jiraStatus])
  const [projectKey, setProjectKey] = useState(projectKeys[0] ?? 'VDA')
  const [boards, setBoards] = useState<JiraAgileBoard[]>([])
  const [boardId, setBoardId] = useState<string | null>(null)
  const [sprints, setSprints] = useState<JiraSprint[]>([])
  const [sprintId, setSprintId] = useState<string | null>(null)
  const [backlogIssues, setBacklogIssues] = useState<JiraSprintIssue[]>([])
  const [sprintIssues, setSprintIssues] = useState<JiraSprintIssue[]>([])
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [loadingSprints, setLoadingSprints] = useState(false)
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [mutationLoading, setMutationLoading] = useState(false)
  const [dragState, setDragState] = useState<SprintDragState | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<SprintColumn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [undoAction, setUndoAction] = useState<SprintUndo | null>(null)
  const boardRequestRef = useRef(0)
  const sprintRequestRef = useRef(0)
  const issueRequestRef = useRef(0)
  const linkedKeys = useMemo(
    () => new Set(linkedIssueKeys.map(key => key.trim().toUpperCase())),
    [linkedIssueKeys]
  )

  useEffect(() => {
    if (!projectKeys.includes(projectKey)) setProjectKey(projectKeys[0] ?? 'VDA')
  }, [projectKeys, projectKey])

  useEffect(() => {
    if (!jiraStatus?.configured || !projectKey) return
    const requestId = ++boardRequestRef.current
    setLoadingBoards(true)
    setError(null)
    setBoards([])
    setBoardId(null)
    setSprints([])
    setSprintId(null)
    setBacklogIssues([])
    setSprintIssues([])
    void window.hrs
      .getJiraBoards(projectKey)
      .then(result => {
        if (requestId !== boardRequestRef.current) return
        setBoards(result)
        const saved = localStorage.getItem(`hrs-sprint-board:${projectKey}`)
        const preferred = result.find(board => String(board.id) === saved) ?? result[0]
        setBoardId(preferred ? String(preferred.id) : null)
        if (!result.length) setError(`No Scrum board is available for ${projectKey}.`)
      })
      .catch(reason => {
        if (requestId === boardRequestRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (requestId === boardRequestRef.current) setLoadingBoards(false)
      })
  }, [jiraStatus?.configured, projectKey])

  useEffect(() => {
    if (!boardId) return
    const parsedBoardId = Number(boardId)
    if (!Number.isFinite(parsedBoardId)) return
    localStorage.setItem(`hrs-sprint-board:${projectKey}`, boardId)
    const requestId = ++sprintRequestRef.current
    setLoadingSprints(true)
    setError(null)
    setSprints([])
    setSprintId(null)
    setBacklogIssues([])
    setSprintIssues([])
    void window.hrs
      .getJiraSprints(parsedBoardId)
      .then(result => {
        if (requestId !== sprintRequestRef.current) return
        setSprints(result)
        const saved = localStorage.getItem(`hrs-sprint:${boardId}`)
        const preferred =
          result.find(sprint => String(sprint.id) === saved) ??
          result.find(sprint => sprint.state === 'active') ??
          result[0]
        setSprintId(preferred ? String(preferred.id) : null)
        if (!result.length) setError('This board has no active or future sprint.')
      })
      .catch(reason => {
        if (requestId === sprintRequestRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (requestId === sprintRequestRef.current) setLoadingSprints(false)
      })
  }, [boardId, projectKey])

  async function refreshIssues(options: { quiet?: boolean } = {}) {
    if (!boardId || !sprintId) return
    const parsedBoardId = Number(boardId)
    const parsedSprintId = Number(sprintId)
    if (!Number.isFinite(parsedBoardId) || !Number.isFinite(parsedSprintId)) return
    const requestId = ++issueRequestRef.current
    if (!options.quiet) setLoadingIssues(true)
    setError(null)
    try {
      const [backlog, sprint] = await Promise.all([
        window.hrs.getJiraBacklogIssues(parsedBoardId),
        window.hrs.getJiraSprintIssues(parsedBoardId, parsedSprintId)
      ])
      if (requestId !== issueRequestRef.current) return
      setBacklogIssues(backlog)
      setSprintIssues(sprint)
    } catch (reason) {
      if (requestId === issueRequestRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (requestId === issueRequestRef.current && !options.quiet) setLoadingIssues(false)
    }
  }

  useEffect(() => {
    if (!boardId || !sprintId) return
    localStorage.setItem(`hrs-sprint:${boardId}`, sprintId)
    void refreshIssues()
  }, [boardId, sprintId])

  const selectedSprint = useMemo(
    () => sprints.find(sprint => String(sprint.id) === sprintId) ?? null,
    [sprints, sprintId]
  )

  const issuesByColumn = useMemo<Record<SprintColumn, JiraSprintIssue[]>>(
    () => ({
      backlog: backlogIssues,
      todo: sprintIssues.filter(issue => issue.statusCategoryKey === 'todo'),
      indeterminate: sprintIssues.filter(issue => issue.statusCategoryKey === 'indeterminate'),
      done: sprintIssues.filter(issue => issue.statusCategoryKey === 'done')
    }),
    [backlogIssues, sprintIssues]
  )

  async function transitionToColumn(issueKey: string, column: Exclude<SprintColumn, 'backlog'>) {
    const transitions = await window.hrs.getJiraTransitions(issueKey)
    const transition = transitions.find(
      item => categoryForStatusName(item.toStatusName) === column
    )
    if (!transition) {
      throw new Error(`No Jira transition is available for ${COLUMN_LABELS[column]}.`)
    }
    await window.hrs.transitionJiraIssue({ issueKey, transitionId: transition.id })
  }

  function optimisticallyMove(
    issue: JiraSprintIssue,
    target: SprintColumn
  ) {
    setBacklogIssues(previous => previous.filter(item => item.key !== issue.key))
    setSprintIssues(previous => {
      const withoutIssue = previous.filter(item => item.key !== issue.key)
      if (target === 'backlog') return withoutIssue
      return [
        ...withoutIssue,
        {
          ...issue,
          statusCategoryKey: target,
          statusName: statusNameForColumn(target)
        }
      ]
    })
    if (target === 'backlog') {
      setBacklogIssues(previous => [...previous, issue])
    }
  }

  async function moveIssue(issueKey: string, source: SprintColumn, target: SprintColumn) {
    if (source === target || mutationLoading || !sprintId) return
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
            sprintId: Number(sprintId),
            issueKeys: [issue.key]
          })
        }
        if (issue.statusCategoryKey !== target) {
          await transitionToColumn(issue.key, target)
        }
      }
      const sourceLabel = COLUMN_LABELS[source]
      const targetLabel = COLUMN_LABELS[target]
      setSuccess(`${issue.key} moved from ${sourceLabel} to ${targetLabel}.`)
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
              sprintId: Number(sprintId),
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

  async function rankIssue(
    issueKey: string,
    targetIssueKey: string,
    column: SprintColumn
  ) {
    if (issueKey === targetIssueKey || mutationLoading) return
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
      const untouched = sprintIssues.filter(issue => !keys.has(issue.key))
      setSprintIssues([...untouched, ...reordered])
    }
    setMutationLoading(true)
    setError(null)
    try {
      await window.hrs.rankJiraIssues({
        issueKeys: [issueKey],
        rankBeforeIssue: targetIssueKey
      })
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
    if (!dragState) return
    void moveIssue(dragState.issueKey, dragState.source, target)
  }

  function renderIssueCard(issue: JiraSprintIssue, column: SprintColumn) {
    const linked = linkedKeys.has(issue.key.toUpperCase())
    return (
      <Card
        key={issue.key}
        data-issue-key={issue.key}
        data-column={column}
        withBorder
        radius="md"
        className={`sprint-issue-card${dragState?.issueKey === issue.key ? ' is-dragging' : ''}`}
        draggable={!mutationLoading}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', issue.key)
          setDragState({ issueKey: issue.key, source: column })
        }}
        onDragEnd={() => {
          setDragState(null)
          setDragOverColumn(null)
        }}
        onDragOver={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={event => {
          event.preventDefault()
          event.stopPropagation()
          if (!dragState) return
          if (dragState.source === column) {
            void rankIssue(dragState.issueKey, issue.key, column)
          } else {
            void moveIssue(dragState.issueKey, dragState.source, column)
          }
        }}
      >
        <Stack gap={7}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <IconGripVertical size={15} className="sprint-card-grip" />
              <Text size="xs" fw={800} className="sprint-issue-key">
                {issue.key}
              </Text>
            </Group>
            {linked ? (
              <Badge size="xs" variant="light" color="cyan">
                HRS linked
              </Badge>
            ) : null}
          </Group>
          <Text size="sm" fw={700} lineClamp={2} className="sprint-issue-summary">
            {issue.summary}
          </Text>
          <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
            <Text size="xs" c="dimmed" truncate>
              {issue.assigneeName || 'Unassigned'}
            </Text>
            <Tooltip
              label={`${formatSeconds(issue.timespent)} logged of ${formatSeconds(issue.estimateSeconds)} estimated`}
              withArrow
            >
              <Group gap={4} wrap="nowrap" className="sprint-card-time">
                <IconClock size={12} />
                <Text size="xs">
                  {formatSeconds(issue.timespent)} / {formatSeconds(issue.estimateSeconds)}
                </Text>
              </Group>
            </Tooltip>
          </Group>
        </Stack>
      </Card>
    )
  }

  if (!jiraStatus?.configured) {
    return (
      <Card withBorder radius="lg" className="sprint-empty-state">
        <Stack align="center" gap="sm">
          <IconRoute size={36} />
          <Text fw={800}>Connect Jira to manage sprints</Text>
          <Text size="sm" c="dimmed" ta="center">
            The Sprint Board uses the same Jira API token and permissions as HRS Desktop.
          </Text>
          <Button leftSection={<IconSettings size={15} />} onClick={onOpenSettings}>
            Open settings
          </Button>
        </Stack>
      </Card>
    )
  }

  return (
    <Stack gap="md" className="sprint-board-root">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap={5}>
          <Group gap="xs">
            <IconRoute size={22} />
            <Text fw={900} size="xl">
              Jira Sprint Board
            </Text>
          </Group>
          <Text size="sm" c="dimmed">
            Drag Jira issues between backlog and sprint statuses. Every drop is saved to Jira.
          </Text>
        </Stack>
        <Group gap="xs">
          {mutationLoading ? <Loader size="sm" /> : null}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={loadingIssues}
            disabled={!boardId || !sprintId}
            onClick={() => void refreshIssues()}
          >
            Refresh
          </Button>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconSettings size={14} />}
            onClick={onOpenSettings}
          >
            Settings
          </Button>
        </Group>
      </Group>

      <Card withBorder radius="lg" className="sprint-board-toolbar">
        <Group align="flex-end" gap="md" wrap="wrap">
          <div>
            <Text size="xs" fw={800} mb={6}>
              Jira project
            </Text>
            <SegmentedControl
              value={projectKey}
              onChange={setProjectKey}
              data={projectKeys.map(key => ({ value: key, label: key }))}
              size="xs"
            />
          </div>
          <Select
            label="Scrum board"
            placeholder={loadingBoards ? 'Loading boards…' : 'Choose board'}
            data={boards.map(board => ({ value: String(board.id), label: board.name }))}
            value={boardId}
            onChange={setBoardId}
            searchable
            disabled={loadingBoards || !boards.length}
            rightSection={loadingBoards ? <Loader size={14} /> : undefined}
            className="sprint-board-select"
          />
          <Select
            label="Sprint"
            placeholder={loadingSprints ? 'Loading sprints…' : 'Choose sprint'}
            data={sprints.map(sprint => ({
              value: String(sprint.id),
              label: `${sprint.state === 'active' ? '● ' : ''}${sprint.name}`
            }))}
            value={sprintId}
            onChange={setSprintId}
            searchable
            disabled={loadingSprints || !sprints.length}
            rightSection={loadingSprints ? <Loader size={14} /> : undefined}
            className="sprint-board-select"
          />
          {selectedSprint ? (
            <Stack gap={3} className="sprint-goal-copy">
              <Badge size="xs" color={selectedSprint.state === 'active' ? 'teal' : 'blue'}>
                {selectedSprint.state}
              </Badge>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {selectedSprint.goal || 'No sprint goal'}
              </Text>
            </Stack>
          ) : null}
        </Group>
      </Card>

      {error ? (
        <Alert color="red" variant="light" radius="md">
          {error}
        </Alert>
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

      <div className="sprint-board-columns" aria-busy={loadingIssues || mutationLoading}>
        {(Object.keys(COLUMN_LABELS) as SprintColumn[]).map(column => {
          const issues = issuesByColumn[column]
          return (
            <section
              key={column}
              data-sprint-column={column}
              className={[
                'sprint-column',
                `is-${column}`,
                dragOverColumn === column ? 'is-drag-over' : ''
              ]
                .join(' ')
                .trim()}
              onDragEnter={event => {
                event.preventDefault()
                setDragOverColumn(column)
              }}
              onDragOver={event => {
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
                <Text fw={800} size="sm">
                  {COLUMN_LABELS[column]}
                </Text>
                <Badge size="xs" variant="light">
                  {issues.length}
                </Badge>
              </Group>
              <Stack gap="xs" className="sprint-column-list">
                {issues.map(issue => renderIssueCard(issue, column))}
                {!issues.length ? (
                  <div className="sprint-column-empty">
                    <Text size="xs" c="dimmed" ta="center">
                      Drop issues here
                    </Text>
                  </div>
                ) : null}
              </Stack>
            </section>
          )
        })}
      </div>

      <Text size="xs" c="dimmed" ta="center">
        Moving and ranking issues requires Jira Edit and Schedule Issues permissions. Sprint creation
        and completion remain managed in Jira for this first version.
      </Text>
    </Stack>
  )
}
