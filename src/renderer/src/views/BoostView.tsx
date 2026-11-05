import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BoostProfileId, BoostState, SystemSnapshot } from '@shared/types'
import { planBoost } from '@shared/engine/boost'
import { describeIdentity, formatBytes, formatPercent } from '../format'
import { Icon, type IconName } from '../components/Icon'
import { AppAvatar, CategoryBadge } from '../components/ui'

interface Props {
  snapshot: SystemSnapshot
  boost: BoostState
  busy: boolean
  onApply: (profile: BoostProfileId, focusGroupId: string | undefined, ecoGroupIds: string[]) => void
  onStop: () => void
}

const PROFILES: Array<{ id: BoostProfileId; icon: IconName }> = [
  { id: 'gaming', icon: 'rocket' },
  { id: 'work', icon: 'target' },
  { id: 'creative', icon: 'cpu' },
  { id: 'custom', icon: 'settings' }
]

export function BoostView({ snapshot, boost, busy, onApply, onStop }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [profile, setProfile] = useState<BoostProfileId>(boost.profile ?? 'gaming')
  const [focusId, setFocusId] = useState<string | undefined>(() => boost.apps.find((a) => a.role === 'focus')?.groupIds[0])
  const [selected, setSelected] = useState<Set<string> | null>(() =>
    boost.active ? new Set(boost.apps.filter((a) => a.role === 'eco').flatMap((a) => a.groupIds)) : null
  )

  const plan = useMemo(() => planBoost(snapshot.groups, profile, focusId), [snapshot.groups, profile, focusId])

  // The profile's suggestion is taken once (on open / profile change); refreshes never override the user's choice.
  useEffect(() => {
    if (selected === null) setSelected(new Set(plan.candidates.filter((c) => c.recommended).map((c) => c.group.id)))
  }, [plan, selected])

  const pickProfile = (id: BoostProfileId) => {
    setProfile(id)
    setSelected(null)
    if (id === 'work') setFocusId(undefined)
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev ?? [])
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const chosen = plan.candidates.filter((c) => selected?.has(c.group.id)).map((c) => c.group.id)
  const focus = plan.focusOptions.find((g) => g.id === focusId)
  const showFocus = profile !== 'work'
  const time = boost.startedAt ? new Date(boost.startedAt).toLocaleTimeString(lng, { hour: '2-digit', minute: '2-digit' }) : ''
  const isWin = window.repid ? window.repid.platform === 'win32' : true

  return (
    <div className="boost">
      <section className={`clean-hero ${boost.active ? 'clean-hero--active' : ''}`}>
        <span className="clean-hero__icon"><Icon name="rocket" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('boost.title')}</h2>
          <p>
            {boost.active
              ? t('boost.active', { profile: t(`boost.profiles.${boost.profile ?? 'custom'}.title`), count: boost.apps.length, time })
              : t('boost.inactive')}
          </p>
        </div>
        {boost.active && (
          <button className="btn btn--secondary btn--lg" onClick={onStop} disabled={busy}>
            <Icon name="undo" size={16} /> {t('boost.restore')}
          </button>
        )}
        <button
          className="btn btn--primary btn--lg"
          disabled={busy || (!chosen.length && !focus)}
          onClick={() => onApply(profile, showFocus ? focus?.id : undefined, chosen)}
        >
          <Icon name="bolt" size={16} /> {boost.active ? t('boost.update') : t('boost.apply')}
        </button>
      </section>

      <p className="callout callout--info">
        <Icon name="shield" size={16} /> {t('boost.safeNote')}
      </p>
      {boost.restorePending && <p className="callout callout--caution"><Icon name="warning" size={16} /> {t('boost.restorePending')}</p>}

      {boost.active && boost.apps.length > 0 && (
        <section className="panel">
          <header className="panel__header"><h2><Icon name="leaf" size={16} /> {t('boost.activeTitle')}</h2></header>
          <ul className="boost-active">
            {boost.apps.map((a) => (
              <li key={a.key}>
                <AppAvatar name={a.product ?? a.name} size={28} />
                <div className="boost-active__text">
                  <strong>{a.product ?? a.name}</strong>
                  <small className="muted">
                    {a.groupIds.length
                      ? [t('boost.applied', { count: a.applied }), a.refused ? t('boost.refused', { count: a.refused }) : '', a.ecoQos ? t('boost.ecoQos') : '']
                          .filter(Boolean)
                          .join(' · ')
                      : t('boost.notRunning')}
                  </small>
                </div>
                <span className={`badge ${a.role === 'focus' ? 'badge--focus' : 'badge--eco'}`}>
                  <Icon name={a.role === 'focus' ? 'target' : 'leaf'} size={12} /> {t(`boost.roles.${a.role}`)}
                </span>
                <span className="boost-active__usage mono">
                  {formatPercent(a.cpu, lng)} · {formatBytes(a.memBytes, lng)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel boost-config">
        <header className="panel__header"><h2>{t('boost.profileLabel')}</h2></header>
        <div className="boost-profiles" role="radiogroup" aria-label={t('boost.profileLabel')}>
          {PROFILES.map((p) => (
            <button key={p.id} role="radio" aria-checked={profile === p.id} className={`boost-profile ${profile === p.id ? 'is-active' : ''}`} onClick={() => pickProfile(p.id)}>
              <span className="boost-profile__icon"><Icon name={p.icon} size={18} /></span>
              <strong>{t(`boost.profiles.${p.id}.title`)}</strong>
              <small>{t(`boost.profiles.${p.id}.desc`)}</small>
            </button>
          ))}
        </div>

        {showFocus && (
          <div className="boost-focus">
            <label htmlFor="boost-focus">
              <Icon name="target" size={16} /> <strong>{t('boost.focus.label')}</strong>
            </label>
            <select id="boost-focus" value={focusId ?? ''} disabled={!boost.focusSupported} onChange={(e) => setFocusId(e.target.value || undefined)}>
              <option value="">{t('boost.focus.none')}</option>
              {plan.focusOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.identity.product ?? g.name}</option>
              ))}
            </select>
            <small className="muted">{boost.focusSupported ? t('boost.focus.hint') : t('boost.focus.unsupported')}</small>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>{t('boost.listTitle')}</h2>
            <small className="muted">{t('boost.listHint')}</small>
          </div>
          <span className="muted">{t('boost.selected', { count: chosen.length })}</span>
        </header>
        <p className="boost-effect">
          <span className="clean-row__what">{t('boost.whatHappens')}</span> {t('boost.ecoEffect')} {isWin && t('boost.ecoQosNote')}
        </p>
        {!plan.candidates.length && <p className="empty">{t('boost.empty')}</p>}
        <ul className="clean-list">
          {plan.candidates.map(({ group: g, recommended }) => (
            <li key={g.id} className="clean-row">
              <label className="clean-row__main">
                <input type="checkbox" checked={selected?.has(g.id) ?? false} disabled={busy} onChange={(e) => toggle(g.id, e.target.checked)} />
                <AppAvatar name={g.identity.product ?? g.name} size={30} />
                <div className="clean-row__text">
                  <div className="clean-row__title">
                    <strong>{g.identity.product ?? g.name}</strong>
                    <CategoryBadge category={g.identity.category} />
                    {recommended && <span className="badge badge--suggested"><Icon name="sparkles" size={12} /> {t('boost.suggested')}</span>}
                  </div>
                  <p className="clean-row__effect">{describeIdentity(g.identity, t)}</p>
                </div>
              </label>
              <span className="clean-row__size">
                {formatPercent(g.cpu, lng)}
                <small>{formatBytes(g.memBytes, lng)}</small>
              </span>
            </li>
          ))}
        </ul>
        <p className="boost-protected muted"><Icon name="lock" size={13} /> {t('boost.protectedCount', { count: plan.protectedCount })}</p>
      </section>
    </div>
  )
}
