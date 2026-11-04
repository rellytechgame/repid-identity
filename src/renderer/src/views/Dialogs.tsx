import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppGroup, Platform } from '@shared/types'
import { describeIdentity, formatBytes, formatPercent } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, ImpactBar, Modal, RiskBadge } from '../components/ui'

export interface KillOptions {
  force: boolean
  allowCaution: boolean
}

export function ConfirmKill({ groups, platform, onCancel, onConfirm }: {
  groups: AppGroup[]
  platform: Platform
  onCancel: () => void
  onConfirm: (opts: KillOptions) => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const hasCaution = groups.some((g) => g.risk === 'caution')
  const [ack, setAck] = useState(false)
  const [force, setForce] = useState(false)
  const total = groups.reduce((s, g) => s + g.pids.length + g.descendantPids.length, 0)
  const mem = groups.reduce((s, g) => s + g.memBytes, 0)

  return (
    <Modal
      title={t('confirm.title', { count: groups.length })}
      icon="tree"
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn--danger" disabled={hasCaution && !ack} onClick={() => onConfirm({ force, allowCaution: ack })}>
            <Icon name="stop" size={16} /> {t('confirm.action', { count: total })}
          </button>
        </>
      }
    >
      <p>{t('confirm.body', { count: total, mem: formatBytes(mem, lng) })}</p>
      <ul className="confirm-list">
        {groups.map((g) => (
          <li key={g.id}>
            <AppAvatar name={g.name} size={28} />
            <div>
              <strong>{g.identity.product ?? g.name}</strong> <RiskBadge risk={g.risk} />
              <p className="muted">{t('confirm.treeInfo', { own: g.pids.length, children: g.descendantPids.length })}</p>
            </div>
            <span className="muted">{formatBytes(g.memBytes, lng)}</span>
          </li>
        ))}
      </ul>
      <p className="callout callout--info"><Icon name="info" size={16} /> {t('confirm.unsaved')}</p>
      {hasCaution && (
        <label className="checkbox callout callout--caution">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          {t('confirm.cautionAck')}
        </label>
      )}
      {platform !== 'win32' && platform !== 'web' && (
        <label className="checkbox">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          {t('confirm.force')}
        </label>
      )}
    </Modal>
  )
}

export function SmartFree({ suggestions, onCancel, onConfirm }: {
  suggestions: AppGroup[]
  onCancel: () => void
  onConfirm: (groups: AppGroup[]) => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [picked, setPicked] = useState<Set<string>>(() => new Set(suggestions.map((g) => g.id)))
  const chosen = suggestions.filter((g) => picked.has(g.id))
  const mem = chosen.reduce((s, g) => s + g.memBytes, 0)
  const cpu = Math.min(100, chosen.reduce((s, g) => s + g.cpu, 0))

  return (
    <Modal
      title={t('smart.title')}
      icon="sparkles"
      wide
      onClose={onCancel}
      footer={
        <>
          <span className="modal__summary">{t('smart.summary', { mem: formatBytes(mem, lng), cpu: formatPercent(cpu, lng) })}</span>
          <button className="btn btn--ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn--primary" disabled={!chosen.length} onClick={() => onConfirm(chosen)}>
            <Icon name="bolt" size={16} /> {t('smart.confirm', { count: chosen.length })}
          </button>
        </>
      }
    >
      <p className="muted">{t('smart.explain')}</p>
      <ul className="smart-list">
        {suggestions.map((g) => (
          <li key={g.id}>
            <label>
              <input
                type="checkbox"
                checked={picked.has(g.id)}
                onChange={(e) =>
                  setPicked((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(g.id)
                    else next.delete(g.id)
                    return next
                  })
                }
              />
              <AppAvatar name={g.name} size={34} />
              <div className="smart-list__main">
                <strong>{g.identity.product ?? g.name}</strong>
                <p className="muted clamp-2">{describeIdentity(g.identity, t)}</p>
              </div>
              <div className="smart-list__stats">
                <span>{formatBytes(g.memBytes, lng)}</span>
                <span>{formatPercent(g.cpu, lng)} CPU</span>
              </div>
              <ImpactBar value={g.impact} />
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
