import type { AgentArtifact, AgentTurnAction } from '@pji-workbench/agent'
import { useState } from 'react'

const TRAIL_PREVIEW_LIMIT = 8

export function actionTrailLabel(actionId: string): string {
  const parts = actionId.split('.').filter((part) => part.length > 0)
  const last = parts.at(-1) ?? actionId
  const prior = parts.at(-2)
  const raw =
    prior === undefined || prior === 'analysis' || prior === 'geo' ? last : `${prior} ${last}`
  return raw.replaceAll(/[-_]+/gu, ' ').replace(/^\w/u, (character) => character.toUpperCase())
}

export function AgentActionTrail({
  actions,
  artifacts = [],
  headingId,
  prefix,
  status,
}: {
  readonly actions: readonly AgentTurnAction[]
  readonly artifacts?: readonly AgentArtifact[]
  readonly headingId: string
  readonly prefix: string
  readonly status: 'active' | 'complete'
}) {
  const [expanded, setExpanded] = useState(status === 'active')
  if (actions.length === 0 && status !== 'active') return null
  const current = status === 'active' ? actions.at(-1) : undefined
  const listed = status === 'active' ? actions.slice(-1) : actions
  const summary =
    status === 'active'
      ? current === undefined
        ? 'Working…'
        : actionTrailLabel(current.actionId)
      : `${actions.length} ${actions.length === 1 ? 'action' : 'actions'}`
  const previews = artifacts.slice(-TRAIL_PREVIEW_LIMIT)
  return (
    <details
      className={`${prefix}__trail`}
      data-trail-status={status}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open)
      }}
      {...(status === 'active' ? { open: true } : {})}
    >
      <summary>
        {status === 'active' ? (
          <span aria-hidden="true" className={`${prefix}__spinner ${prefix}__trail-spinner`} />
        ) : (
          <span aria-hidden="true" className={`${prefix}__trail-chevron`} />
        )}
        <span aria-live={status === 'active' ? 'polite' : undefined}>{summary}</span>
        {status === 'active' && actions.length > 1 ? (
          <span className={`${prefix}__trail-hint`}>{actions.length - 1} done</span>
        ) : null}
        {status === 'complete' && actions.length > 0 ? (
          <span className={`${prefix}__trail-hint`}>Show work</span>
        ) : null}
      </summary>
      <h3 className="visually-hidden" id={headingId}>
        Action trace
      </h3>
      {listed.length === 0 ? (
        <p className={`${prefix}__trail-empty`}>Reading the workspace…</p>
      ) : (
        <ol aria-labelledby={headingId} className={`${prefix}__trail-list`}>
          {listed.map((action) => {
            const currentAction = action.callId === current?.callId
            return (
              <li
                key={action.callId}
                data-agent-action-id={action.actionId}
                data-current={currentAction ? 'true' : 'false'}
              >
                <span aria-hidden="true" className={`${prefix}__trail-mark`} />
                <span>{actionTrailLabel(action.actionId)}</span>
                <span>{currentAction ? 'Running' : action.approval}</span>
              </li>
            )
          })}
        </ol>
      )}
      {!expanded || previews.length === 0 ? null : (
        <div className={`${prefix}__trail-previews`}>
          {previews.map((artifact) => (
            <figure key={artifact.id}>
              <img alt="Bounded workbench preview shared with the model" src={artifact.dataUrl} />
            </figure>
          ))}
        </div>
      )}
    </details>
  )
}
