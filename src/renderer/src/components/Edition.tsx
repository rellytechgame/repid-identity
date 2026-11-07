import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditionState } from '@shared/types'
import { api } from '../api'
import { Icon } from './Icon'

const MONTH = 30 * 24 * 3600 * 1000

/**
 * Top-of-window notice about the edition: required action (limited mode) or a
 * gentle hint (company computer on the free edition, which can be hidden for 30 days).
 */
export function EditionBanner({
  state,
  corporateHiddenUntil,
  onHideCorporate,
  onOpenLicense
}: {
  state: EditionState
  corporateHiddenUntil?: number
  onHideCorporate: (until: number) => void
  onOpenLicense: () => void
}) {
  const { t, i18n } = useTranslation()
  if (state.edition === 'free') {
    if (state.limited) {
      return (
        <div className="update-banner edition-banner edition-banner--limit" role="alert">
          <Icon name="lock" size={18} />
          <span>
            <strong>{t('edition.lanLimit.title', { count: state.lanInstalls })}</strong> {t('edition.lanLimit.body', { limit: state.lanLimit })}
          </span>
          <button className="btn btn--primary btn--sm" onClick={() => void api.openRelease()}>
            <Icon name="download" size={14} /> {t('edition.getEnterprise')}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.openEnterpriseBuy()}>{t('edition.buy')}</button>
        </div>
      )
    }
    if (state.corporate && Date.now() > (corporateHiddenUntil ?? 0)) {
      return (
        <div className="update-banner edition-banner" role="status">
          <Icon name="shield" size={18} />
          <span>
            <strong>{t('edition.corporate.title')}</strong> {t('edition.corporate.body')}
          </span>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.openEnterpriseBuy()}>{t('edition.buy')}</button>
          <button className="icon-btn icon-btn--sm" aria-label={t('edition.corporate.hide')} title={t('edition.corporate.hide')} onClick={() => onHideCorporate(Date.now() + MONTH)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )
    }
    return null
  }
  // Enterprise
  const lic = state.license
  if (!state.limited && !(state.reason === 'expired' && lic?.graceUntil)) return null
  const date = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(i18n.language, { dateStyle: 'medium' }) : '')
  return (
    <div className={`update-banner edition-banner ${state.limited ? 'edition-banner--limit' : ''}`} role="alert">
      <Icon name="lock" size={18} />
      <span>
        <strong>{t(`edition.enterprise.${state.reason ?? 'no-license'}.title`, { seats: lic?.seats, used: lic?.seatsInUse })}</strong>{' '}
        {t(`edition.enterprise.${state.reason ?? 'no-license'}.body`, { date: date(lic?.graceUntil) })}
      </span>
      <button className="btn btn--primary btn--sm" onClick={onOpenLicense}>{t('edition.activate')}</button>
      <button className="btn btn--secondary btn--sm" onClick={() => void api.openEnterpriseBuy()}>{t('edition.buy')}</button>
    </div>
  )
}

/** Shown instead of a locked section. */
export function LockedView({ state, onOpenLicense }: { state: EditionState; onOpenLicense: () => void }) {
  const { t } = useTranslation()
  const free = state.edition === 'free'
  return (
    <div className="locked-view">
      <span className="locked-view__icon"><Icon name="lock" size={30} /></span>
      <h2>{t('edition.locked.title')}</h2>
      <p>{free ? t('edition.locked.free', { count: state.lanInstalls, limit: state.lanLimit }) : t('edition.locked.enterprise')}</p>
      <div className="locked-view__actions">
        {free ? (
          <button className="btn btn--primary" onClick={() => void api.openRelease()}>
            <Icon name="download" size={16} /> {t('edition.getEnterprise')}
          </button>
        ) : (
          <button className="btn btn--primary" onClick={onOpenLicense}>{t('edition.activate')}</button>
        )}
        <button className="btn btn--secondary" onClick={() => void api.openEnterpriseBuy()}>{t('edition.buy')}</button>
      </div>
      <p className="muted">{t('edition.price')}</p>
    </div>
  )
}

/** Edition, license details and activation (About screen). */
export function LicenseCard({ state, onChange }: { state: EditionState; onChange: (s: EditionState) => void }) {
  const { t, i18n } = useTranslation()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const date = (ms: number) => new Date(ms).toLocaleDateString(i18n.language, { dateStyle: 'long' })
  const lic = state.license

  const activate = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.activateLicense(key)
      onChange(res.state)
      if (res.ok) setKey('')
      else setError(t(`edition.errors.${res.error ?? 'invalid'}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="license-card" id="license">
      <header>
        <span className="auto-card__icon"><Icon name={state.edition === 'enterprise' ? 'shield' : 'heart'} size={18} /></span>
        <div>
          <h3>{t(`edition.name.${state.edition}`)}</h3>
          <p className="muted">
            {state.edition === 'free' ? t('edition.freeInfo', { count: state.lanInstalls, limit: state.lanLimit }) : lic ? t('edition.licensedTo', { company: lic.company }) : t('edition.unlicensed')}
          </p>
        </div>
      </header>
      {lic && (
        <dl className="kv-grid">
          <div><dt>{t('edition.seats')}</dt><dd>{t('edition.seatsValue', { used: lic.seatsInUse, seats: lic.seats })}</dd></div>
          <div><dt>{t('edition.expires')}</dt><dd>{date(lic.expiresAt)}</dd></div>
          <div><dt>{t('edition.licenseId')}</dt><dd className="mono">{lic.id}</dd></div>
          <div><dt>{t('edition.issued')}</dt><dd>{date(lic.issuedAt)}</dd></div>
        </dl>
      )}
      {lic && state.edition === 'enterprise' && (
        <div className="license-support">
          <div>
            <span className="muted">{t('edition.supportCode')}</span>
            <strong className="mono">{lic.supportCode}</strong>
          </div>
          <button className="btn btn--primary btn--sm" onClick={() => void api.contactEnterprise('support')}>
            <Icon name="shield" size={14} /> {t('edition.support')}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.contactEnterprise('beta')}>
            <Icon name="sparkles" size={14} /> {t('edition.beta')}
          </button>
        </div>
      )}
      {(state.edition === 'free' || !lic) && (
        <ul className="license-benefits">
          {(t('edition.benefits', { returnObjects: true }) as string[]).map((b) => (
            <li key={b}><Icon name="check" size={14} /> {b}</li>
          ))}
        </ul>
      )}
      {state.edition === 'enterprise' && (
        <div className="license-card__form">
          <label htmlFor="license-key">{lic ? t('edition.replaceKey') : t('edition.pasteKey')}</label>
          <textarea id="license-key" className="mono" rows={3} value={key} spellCheck={false} placeholder="REPID1-…" onChange={(e) => setKey(e.target.value)} />
          {error && <p className="callout callout--critical">{error}</p>}
          <div className="license-card__actions">
            <button className="btn btn--primary btn--sm" disabled={!key.trim() || busy} onClick={() => void activate()}>{t('edition.activate')}</button>
            {lic && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void api.removeLicense().then(onChange)}>{t('edition.remove')}</button>}
          </div>
        </div>
      )}
      <div className="license-card__actions">
        <button className="btn btn--secondary btn--sm" onClick={() => void api.openEnterpriseBuy()}>{t('edition.buy')}</button>
        {state.edition === 'free' && <button className="btn btn--ghost btn--sm" onClick={() => void api.openRelease()}>{t('edition.getEnterprise')}</button>}
        <span className="muted">{t('edition.price')}</span>
      </div>
    </section>
  )
}
