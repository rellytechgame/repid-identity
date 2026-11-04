import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppGroup, Category, SystemSnapshot } from '@shared/types'
import { describeIdentity, formatBytes, formatPercent } from '../format'
import { Icon } from '../components/Icon'
import { AppAvatar, CategoryBadge, ImpactBar, RiskBadge } from '../components/ui'

type SortKey = 'impact' | 'cpu' | 'memBytes' | 'gpu' | 'name'

interface Props {
  snapshot: SystemSnapshot
  selectedId?: string
  showProtected: boolean
  onToggleProtected: (v: boolean) => void
  onSelect: (g: AppGroup) => void
  onKill: (groups: AppGroup[]) => void
}

export function Processes({ snapshot, selectedId, showProtected, onToggleProtected, onSelect, onKill }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'impact', dir: -1 })
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const categories = useMemo(
    () => [...new Set(snapshot.groups.map((g) => g.identity.category))].sort(),
    [snapshot.groups]
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snapshot.groups
      .filter((g) => showProtected || g.risk !== 'critical')
      .filter((g) => category === 'all' || g.identity.category === category)
      .filter(
        (g) =>
          !q ||
          g.name.toLowerCase().includes(q) ||
          (g.identity.product ?? '').toLowerCase().includes(q) ||
          g.pids.some((p) => String(p) === q) ||
          g.services.some((s) => s.name.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        const av = sort.key === 'name' ? a.name.toLowerCase() : a[sort.key]
        const bv = sort.key === 'name' ? b.name.toLowerCase() : b[sort.key]
        return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir
      })
  }, [snapshot.groups, query, category, sort, showProtected])

  const selectedGroups = rows.filter((g) => checked.has(g.id) && g.risk !== 'critical')

  const header = (key: SortKey, label: string, className = '') => (
    <th className={className}>
      <button
        className={`th-btn ${sort.key === key ? 'th-btn--active' : ''}`}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'name' ? 1 : -1 }))}
        aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      >
        {label} {sort.key === key && (sort.dir === 1 ? '↑' : '↓')}
      </button>
    </th>
  )

  return (
    <div className="processes">
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('processes.search')}
            aria-label={t('processes.search')}
          />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'all')} aria-label={t('processes.category')}>
          <option value="all">{t('processes.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </select>
        <label className="switch">
          <input type="checkbox" checked={showProtected} onChange={(e) => onToggleProtected(e.target.checked)} />
          <span className="switch__track" />
          {t('processes.showProtected')}
        </label>
        <div className="toolbar__spacer" />
        {selectedGroups.length > 0 && (
          <button
            className="btn btn--danger"
            onClick={() => {
              onKill(selectedGroups)
              setChecked(new Set())
            }}
          >
            <Icon name="tree" size={16} /> {t('processes.endSelected', { count: selectedGroups.length })}
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="ptable">
          <thead>
            <tr>
              <th className="col-check" />
              {header('name', t('processes.colApp'))}
              <th className="col-desc">{t('processes.colWhat')}</th>
              {header('cpu', 'CPU', 'col-num')}
              {header('memBytes', 'RAM', 'col-num')}
              {header('gpu', 'GPU', 'col-num')}
              {header('impact', t('processes.colImpact'), 'col-impact')}
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className={selectedId === g.id ? 'is-selected' : ''} onClick={() => onSelect(g)}>
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    disabled={g.risk === 'critical'}
                    checked={checked.has(g.id)}
                    aria-label={g.name}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(g.id)
                        else next.delete(g.id)
                        return next
                      })
                    }
                  />
                </td>
                <td>
                  <div className="app-cell">
                    <AppAvatar name={g.name} size={30} />
                    <div>
                      <div className="app-cell__name">
                        {g.identity.product ?? g.name}
                        <RiskBadge risk={g.risk} />
                      </div>
                      <div className="app-cell__meta">
                        <CategoryBadge category={g.identity.category} />
                        <span>{g.name}</span>
                        <span>· {t('processes.procCount', { count: g.pids.length + g.descendantPids.length })}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="col-desc">
                  <span className="clamp-2">{describeIdentity(g.identity, t)}</span>
                </td>
                <td className="col-num">{formatPercent(g.cpu, lng)}</td>
                <td className="col-num">{formatBytes(g.memBytes, lng)}</td>
                <td className="col-num">{g.gpu > 0 ? formatPercent(g.gpu, lng) : '—'}</td>
                <td className="col-impact">
                  <ImpactBar value={g.impact} />
                </td>
                <td className="col-actions">
                  <button
                    className="btn btn--danger-ghost btn--sm"
                    disabled={g.risk === 'critical'}
                    title={g.risk === 'critical' ? t('risk.criticalHint') : t('actions.endTree')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onKill([g])
                    }}
                  >
                    <Icon name="stop" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">{t('processes.empty')}</p>}
      </div>
    </div>
  )
}
