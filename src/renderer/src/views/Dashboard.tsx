import { useTranslation } from 'react-i18next'
import type { AppGroup, SystemSnapshot } from '@shared/types'
import { suggestTargets } from '@shared/engine/smart'
import type { HistoryPoint } from '../hooks'
import { describeIdentity, formatBytes, formatPercent } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, Gauge, ImpactBar, RiskBadge, Sparkline } from '../components/ui'

interface Props {
  snapshot: SystemSnapshot
  history: HistoryPoint[]
  threshold: number
  onSelect: (g: AppGroup) => void
  onKill: (groups: AppGroup[]) => void
  onSmartFree: () => void
}

export function Dashboard({ snapshot, history, threshold, onSelect, onKill, onSmartFree }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const memPct = (snapshot.mem.used / snapshot.mem.total) * 100
  const gpuName = snapshot.gpu.controllers[0]?.model
  const suggestions = suggestTargets(snapshot.groups, { threshold })
  const reclaimMem = suggestions.reduce((s, g) => s + g.memBytes, 0)
  const reclaimCpu = Math.min(100, suggestions.reduce((s, g) => s + g.cpu, 0))
  const top = snapshot.groups.slice(0, 8)

  return (
    <div className="dashboard">
      <section className="metrics">
        <article className="metric">
          <Gauge value={snapshot.cpu.load} label="CPU" tone="cpu" />
          <div className="metric__body">
            <h3><Icon name="cpu" size={16} /> {t('metrics.cpu')}</h3>
            <p className="metric__sub">{snapshot.cpu.brand}</p>
            <p className="metric__sub">{t('metrics.cores', { count: snapshot.cpu.cores })}</p>
            <Sparkline values={history.map((h) => h.cpu)} tone="cpu" />
          </div>
        </article>
        <article className="metric">
          <Gauge value={memPct} label="RAM" tone="mem" />
          <div className="metric__body">
            <h3><Icon name="memory" size={16} /> {t('metrics.memory')}</h3>
            <p className="metric__sub">
              {t('metrics.memUsed', { used: formatBytes(snapshot.mem.used, lng), total: formatBytes(snapshot.mem.total, lng) })}
            </p>
            <p className="metric__sub">{t('metrics.memAvailable', { value: formatBytes(snapshot.mem.available, lng) })}</p>
            <Sparkline values={history.map((h) => h.mem)} tone="mem" />
          </div>
        </article>
        <article className="metric">
          <Gauge value={snapshot.gpu.utilization ?? 0} label="GPU" tone="gpu" />
          <div className="metric__body">
            <h3><Icon name="gpu" size={16} /> {t('metrics.gpu')}</h3>
            <p className="metric__sub">{gpuName ?? t('metrics.gpuUnknown')}</p>
            <p className="metric__sub">
              {snapshot.gpu.utilization === undefined ? t('metrics.gpuNoData') : t('metrics.gpuLive')}
            </p>
            <Sparkline values={history.map((h) => h.gpu)} tone="gpu" />
          </div>
        </article>
      </section>

      <section className={`smart-card ${suggestions.length ? '' : 'smart-card--calm'}`}>
        <div className="smart-card__icon">
          <Icon name={suggestions.length ? 'sparkles' : 'check'} size={26} />
        </div>
        <div className="smart-card__text">
          <h2>{suggestions.length ? t('smart.headline', { count: suggestions.length }) : t('smart.allGood')}</h2>
          <p>
            {suggestions.length
              ? t('smart.potential', { mem: formatBytes(reclaimMem, lng), cpu: formatPercent(reclaimCpu, lng) })
              : t('smart.allGoodHint')}
          </p>
        </div>
        <button className="btn btn--primary btn--lg" onClick={onSmartFree} disabled={!suggestions.length}>
          <Icon name="bolt" /> {t('smart.cta')}
        </button>
      </section>

      <section className="panel">
        <header className="panel__header">
          <h2>{t('dashboard.topConsumers')}</h2>
          <span className="muted">{t('dashboard.processCount', { count: snapshot.processCount })}</span>
        </header>
        <ul className="top-list">
          {top.map((g) => (
            <li key={g.id} className="top-list__item" onClick={() => onSelect(g)}>
              <AppAvatar name={g.name} />
              <div className="top-list__main">
                <div className="top-list__title">
                  <strong>{g.identity.product ?? g.name}</strong>
                  <RiskBadge risk={g.risk} />
                  {g.pids.length > 1 && <span className="muted">×{g.pids.length}</span>}
                </div>
                <p className="top-list__desc">{describeIdentity(g.identity, t)}</p>
              </div>
              <div className="top-list__stats">
                <span>{formatPercent(g.cpu, lng)} CPU</span>
                <span>{formatBytes(g.memBytes, lng)}</span>
                {g.gpu > 0 && <span>{formatPercent(g.gpu, lng)} GPU</span>}
              </div>
              <ImpactBar value={g.impact} />
              <button
                className="btn btn--danger-ghost btn--sm"
                disabled={g.risk === 'critical'}
                title={g.risk === 'critical' ? t('risk.criticalHint') : t('actions.endTree')}
                onClick={(e) => {
                  e.stopPropagation()
                  onKill([g])
                }}
              >
                <Icon name="stop" size={14} /> {t('actions.end')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
