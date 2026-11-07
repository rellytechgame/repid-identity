import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppUpdateInfo, EditionState } from '@shared/types'
import { LicenseCard } from '../components/Edition'
import { api, isDemo } from '../api'
import { Icon } from '../components/Icon'
import { LogoMark, Wordmark } from '../components/Logo'
import { StarButton } from '../components/ui'
import voxelDark from '../assets/voxel-logo-dark.png'
import voxelLight from '../assets/voxel-logo-light.png'
import supportersData from '@shared/supporters.json'

interface Supporter {
  name: string
  tier: 'coffee' | 'booster' | 'sponsor' | 'company'
}

const TIER_ORDER = { company: 0, sponsor: 1, booster: 2, coffee: 3 }
const supporters = [...(supportersData.supporters as Supporter[])].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])

export function About({
  update,
  onCheck,
  edition,
  onEdition
}: {
  update: AppUpdateInfo | null
  onCheck: () => Promise<AppUpdateInfo | null>
  edition: EditionState | null
  onEdition: (s: EditionState) => void
}) {
  const { t, i18n } = useTranslation()
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    await onCheck()
    setChecking(false)
  }
  return (
    <div className="about">
      <section className="about__hero">
        <LogoMark size={88} />
        <h1><Wordmark /></h1>
        <p className="about__version">{api.version === 'demo' ? t('demo.badge') : `v${api.version}`}</p>
        <p className="about__tagline">{t('about.tagline')}</p>
        <div className="about__actions">
          <StarButton />
          <button className="btn btn--secondary" onClick={() => void api.openRelease()}>
            <Icon name="download" size={16} /> {t('about.releases')}
          </button>
        </div>
        {!isDemo && (
          <div className={`about__update ${update?.available ? 'about__update--new' : ''}`} role="status">
            {update?.available ? (
              <>
                <span><Icon name="download" size={16} /> {t('update.available', { version: update.latest })}</span>
                <button className="btn btn--primary btn--sm" onClick={() => void api.openRelease()}>{t('update.cta')}</button>
              </>
            ) : (
              <>
                <span className="muted">
                  {update?.error && !update.latest
                    ? t('update.error')
                    : update
                      ? t('update.upToDate', { time: new Date(update.checkedAt).toLocaleTimeString(i18n.language, { timeStyle: 'short' }) })
                      : t('update.notChecked')}
                </span>
                <button className="btn btn--ghost btn--sm" onClick={() => void check()} disabled={checking}>
                  {checking ? <span className="spinner spinner--sm" /> : <Icon name="refresh" size={14} />} {t('update.check')}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {edition && !isDemo && <LicenseCard state={edition} onChange={onEdition} />}

      <section className="about__grid">
        <button className="about-card" onClick={() => void api.openRepo('stargazers')}>
          <Icon name="star" size={22} />
          <strong>{t('about.starTitle')}</strong>
          <span>{t('about.starBody')}</span>
        </button>
        <button className="about-card" onClick={() => void api.openRepo('issues')}>
          <Icon name="warning" size={22} />
          <strong>{t('about.issueTitle')}</strong>
          <span>{t('about.issueBody')}</span>
        </button>
        <button className="about-card" onClick={() => void api.openRepo('contributing')}>
          <Icon name="github" size={22} />
          <strong>{t('about.contributeTitle')}</strong>
          <span>{t('about.contributeBody')}</span>
        </button>
        <button className="about-card" onClick={() => void api.openRepo('translate')}>
          <Icon name="globe" size={22} />
          <strong>{t('about.translateTitle')}</strong>
          <span>{t('about.translateBody')}</span>
        </button>
      </section>

      <section className="support-card">
        <span className="support-card__icon"><Icon name="heart" size={24} /></span>
        <div className="support-card__text">
          <h2>{t('about.supportTitle')}</h2>
          <p>{t('about.supportBody')}</p>
        </div>
        <button className="btn btn--primary btn--lg" onClick={() => void api.openDonate()}>
          <Icon name="heart" size={16} /> {t('about.supportCta')}
        </button>
      </section>

      <section className="supporters">
        <h3>{t('about.supportersTitle')}</h3>
        {supporters.length === 0 ? (
          <p className="muted">{t('about.supportersEmpty')}</p>
        ) : (
          <ul className="chips">
            {supporters.map((s) => (
              <li key={s.name} className={`chip chip--${s.tier}`}>{s.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="about__credits">
        <p>{t('about.madeBy')}</p>
        {/* voxel-logo-dark.png is black ink (for light backgrounds); -light.png is white ink. */}
        <img className="voxel-logo voxel-logo--on-light" src={voxelDark} alt="Voxel Enterprise" />
        <img className="voxel-logo voxel-logo--on-dark" src={voxelLight} alt="Voxel Enterprise" />
        <p className="muted">{t('about.license')}</p>
        <p className="muted about__privacy"><Icon name="shield" size={14} /> {t('about.privacy')}</p>
      </section>
    </div>
  )
}
