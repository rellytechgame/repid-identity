import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiskFile, DiskNode, DiskRoot, DiskScanResult, DuplicateScanResult } from '@shared/types'
import { squarify } from '@shared/engine/disk'
import { api } from '../api'
import { formatBytes, hueOf } from '../format'
import { useProgress } from '../hooks'
import { Icon } from '../components/Icon'
import { Modal, type Toast } from '../components/ui'

interface Props {
  notify: (toast: Omit<Toast, 'id'>) => void
}

type Tab = 'map' | 'large' | 'duplicates'
const YEAR = 365 * 24 * 3600 * 1000

export function DiskView({ notify }: Props) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [roots, setRoots] = useState<DiskRoot[]>([])
  const [rootId, setRootId] = useState('home')
  const [scan, setScan] = useState<DiskScanResult | null>(null)
  const [dups, setDups] = useState<DuplicateScanResult | null>(null)
  const [busy, setBusy] = useState<'scan' | 'duplicates' | 'delete' | null>(null)
  const [tab, setTab] = useState<Tab>('map')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [oldOnly, setOldOnly] = useState(false)
  const progress = useProgress(busy === 'scan' ? 'disk-scan' : busy === 'duplicates' ? 'duplicates' : null)

  useEffect(() => {
    void api.diskRoots().then(setRoots).catch(() => undefined)
  }, [])

  const run = async () => {
    setBusy('scan')
    setDups(null)
    setPicked(new Set())
    try {
      setScan(await api.diskScan(rootId))
      setTab('map')
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const findDuplicates = async () => {
    setBusy('duplicates')
    setPicked(new Set())
    setTab('duplicates')
    try {
      setDups(await api.diskDuplicates())
    } catch (err) {
      notify({ tone: 'error', title: t('toast.error'), body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const allFiles = useMemo(() => {
    const map = new Map<string, DiskFile>()
    for (const f of scan?.largeFiles ?? []) map.set(f.id, f)
    for (const g of dups?.groups ?? []) for (const f of g.files) map.set(f.id, f)
    return map
  }, [scan, dups])
  const pickedBytes = [...picked].reduce((s, id) => s + (allFiles.get(id)?.sizeBytes ?? 0), 0)

  const remove = async () => {
    setConfirm(false)
    setBusy('delete')
    try {
      const res = await api.diskDelete({ ids: [...picked] })
      const notes = [res.refused.length ? t('disk.toast.refused', { count: res.refused.length }) : '', res.failed.length ? t('disk.toast.failed', { count: res.failed.length }) : ''].filter(Boolean)
      notify({
        tone: res.removed && !notes.length ? 'success' : res.removed ? 'warning' : 'error',
        title: res.removed ? t('disk.toast.done', { count: res.removed, size: formatBytes(res.recycledBytes, lng) }) : t('disk.toast.nothing'),
        body: notes.join(' ') || undefined
      })
      const gone = new Set([...picked].filter((id) => !res.refused.includes(id) && !res.failed.some((f) => f.id === id)))
      setScan((s) => (s ? { ...s, largeFiles: s.largeFiles.filter((f) => !gone.has(f.id)) } : s))
      setDups((d) =>
        d
          ? {
              ...d,
              groups: d.groups.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.id)) })).filter((g) => g.files.length > 1)
            }
          : d
      )
      setPicked(new Set())
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  const root = roots.find((r) => r.id === rootId)
  const largeVisible = (scan?.largeFiles ?? []).filter((f) => !oldOnly || Date.now() - f.modified > YEAR)

  return (
    <div className="startup disk">
      <section className="clean-hero">
        <span className="clean-hero__icon"><Icon name="disk" size={24} /></span>
        <div className="clean-hero__text">
          <h2>{t('disk.title')}</h2>
          <p>{scan ? t('disk.summary', { size: formatBytes(scan.totalBytes, lng), files: scan.fileCount.toLocaleString(lng), root: scan.root }) : t('disk.intro')}</p>
        </div>
        <select className="select" value={rootId} onChange={(e) => setRootId(e.target.value)} disabled={!!busy} aria-label={t('disk.where')}>
          {roots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind === 'home' ? t('disk.home', { name: r.label }) : r.totalBytes ? t('disk.drive', { path: r.path, free: formatBytes(r.freeBytes ?? 0, lng) }) : r.path}
            </option>
          ))}
        </select>
        <button className="btn btn--primary btn--lg" onClick={() => void run()} disabled={!!busy}>
          <Icon name="search" size={16} /> {scan ? t('disk.rescan') : t('disk.scan')}
        </button>
      </section>

      <p className="callout callout--info">
        <Icon name="shield" size={16} /> {t('disk.safeNote')}
      </p>

      {(busy === 'scan' || busy === 'duplicates') && (
        <div className="callout callout--info progress-callout">
          <span className="spinner spinner--sm" />
          <div>
            <strong>{busy === 'scan' ? t('disk.scanning', { count: (progress?.done ?? 0).toLocaleString(lng) }) : t('disk.hashing')}</strong>
            {progress?.total ? <div className="progress"><span style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} /></div> : null}
            {progress?.current && <small className="muted mono break">{progress.current}</small>}
          </div>
          <button className="btn btn--secondary btn--sm" onClick={() => void api.diskCancel()}>{t('common.cancel')}</button>
        </div>
      )}

      {scan?.truncated && <p className="callout callout--caution">{t('disk.truncated')}</p>}

      {scan && (
        <section className="panel">
          <header className="panel__header">
            <div className="segmented" role="tablist">
              {(['map', 'large', 'duplicates'] as Tab[]).map((x) => (
                <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => setTab(x)}>
                  {t(`disk.tabs.${x}`)}
                  {x === 'large' && <span className="segmented__count">{scan.largeFiles.length}</span>}
                  {x === 'duplicates' && dups && <span className="segmented__count">{dups.groups.length}</span>}
                </button>
              ))}
            </div>
            {picked.size > 0 && (
              <button className="btn btn--danger" onClick={() => setConfirm(true)} disabled={!!busy}>
                <Icon name="trash" size={16} /> {t('disk.deleteSelected', { count: picked.size, size: formatBytes(pickedBytes, lng) })}
              </button>
            )}
          </header>
          <div className="disk-body">
            {tab === 'map' && <Treemap tree={scan.tree} rootLabel={root?.kind === 'home' ? t('disk.home', { name: root.label }) : scan.root} />}
            {tab === 'large' && (
              <>
                <label className="checkbox">
                  <input type="checkbox" checked={oldOnly} onChange={(e) => setOldOnly(e.target.checked)} /> {t('disk.oldOnly')}
                </label>
                {!largeVisible.length && <p className="empty">{t('disk.noLarge')}</p>}
                <ul className="leftover-list">
                  {largeVisible.map((f) => (
                    <FileRow key={f.id} file={f} checked={picked.has(f.id)} onToggle={(on) => toggle(f.id, on)} />
                  ))}
                </ul>
              </>
            )}
            {tab === 'duplicates' && (
              <>
                {!dups && busy !== 'duplicates' && (
                  <div className="empty-cta">
                    <p>{t('disk.dupIntro')}</p>
                    <button className="btn btn--primary" onClick={() => void findDuplicates()} disabled={!!busy}>
                      <Icon name="copy" size={16} /> {t('disk.findDuplicates')}
                    </button>
                  </div>
                )}
                {dups && (
                  <>
                    <div className="orphan-tools" style={dups.groups.length ? undefined : { display: 'none' }}>
                      <span className="muted">{t('disk.dupSummary', { count: dups.groups.length, size: formatBytes(dups.wastedBytes, lng) })}</span>
                      <span className="toolbar__spacer" />
                      <button className="btn btn--ghost btn--sm" onClick={() => setPicked(new Set(dups.groups.flatMap((g) => g.files.filter((f) => f.id !== g.keepId).map((f) => f.id))))}>
                        {t('disk.selectCopies')}
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setPicked(new Set())}>{t('uninstall.orphans.selectNone')}</button>
                    </div>
                    {dups.truncated && <p className="callout callout--caution">{t('disk.dupTruncated')}</p>}
                    {!dups.groups.length && <p className="empty">{t('disk.noDuplicates')}</p>}
                    {dups.groups.map((g) => (
                      <section key={g.id} className="leftover-group">
                        <h3>
                          {t('disk.dupGroup', { count: g.files.length, size: formatBytes(g.sizeBytes, lng) })} <span className="muted mono">#{g.hash.slice(0, 8)}</span>
                        </h3>
                        <ul className="leftover-list">
                          {g.files.map((f) => (
                            <FileRow
                              key={f.id}
                              file={f}
                              checked={picked.has(f.id)}
                              keep={f.id === g.keepId}
                              // The last unchecked copy cannot be checked: one copy always stays.
                              lockKeep={!picked.has(f.id) && g.files.filter((x) => !picked.has(x.id)).length <= 1}
                              onToggle={(on) => toggle(f.id, on)}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {confirm && (
        <Modal
          title={t('disk.confirm.title')}
          icon="trash"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
              <button className="btn btn--danger" onClick={() => void remove()}>
                <Icon name="trash" size={16} /> {t('disk.confirm.action', { count: picked.size })}
              </button>
            </>
          }
        >
          <p>{t('disk.confirm.body', { count: picked.size, size: formatBytes(pickedBytes, lng) })}</p>
          <p className="muted">{t('disk.confirm.recycle')}</p>
        </Modal>
      )}
    </div>
  )
}

function FileRow({ file: f, checked, keep, lockKeep, onToggle }: { file: DiskFile; checked: boolean; keep?: boolean; lockKeep?: boolean; onToggle: (on: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const days = Math.floor((Date.now() - f.modified) / 86400000)
  return (
    <li>
      <label className={f.removable ? '' : 'is-locked'}>
        <input type="checkbox" checked={checked} disabled={!f.removable || (lockKeep && !checked)} onChange={(e) => onToggle(e.target.checked)} />
        <span className="leftover-list__text">
          <span className="mono break">{f.path}</span>
          <small className="muted">
            {t('disk.modified', { date: new Date(f.modified).toLocaleDateString(lng), days })}
            {keep && <> · <span className="badge badge--suggested">{t('disk.keep')}</span></>}
            {!f.removable && <> · <span className="badge badge--critical"><Icon name="lock" size={11} /> {t('disk.system')}</span></>}
          </small>
        </span>
        <span className="leftover-list__size">
          {formatBytes(f.sizeBytes, lng)}
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            title={t('disk.reveal')}
            aria-label={t('disk.reveal')}
            onClick={(e) => {
              e.preventDefault()
              void api.diskReveal(f.id)
            }}
          >
            <Icon name="external" size={14} />
          </button>
        </span>
      </label>
    </li>
  )
}

/** Squarified map of the folder tree; click a folder to zoom in, use the path above to go back. */
function Treemap({ tree, rootLabel }: { tree: DiskNode; rootLabel: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const [path, setPath] = useState<DiskNode[]>([tree])
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 440 })

  useEffect(() => setPath([tree]), [tree])
  const measure = useCallback(() => {
    const el = ref.current
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight })
  }, [])
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [measure])

  const node = path[path.length - 1]
  const tiles = squarify(node.children ?? [], (c) => c.sizeBytes, { x: 0, y: 0, w: size.w, h: size.h })

  return (
    <div className="treemap-wrap">
      <nav className="crumbs" aria-label={t('disk.path')}>
        {path.map((n, i) => (
          <button key={i} className="crumb" disabled={i === path.length - 1} onClick={() => setPath(path.slice(0, i + 1))}>
            {i === 0 ? rootLabel : n.name}
          </button>
        ))}
        <span className="muted">· {formatBytes(node.sizeBytes, lng)}</span>
      </nav>
      <div className="treemap" ref={ref}>
        {!tiles.length && <p className="empty">{t('disk.emptyFolder')}</p>}
        {tiles.map(({ item, x, y, w, h }, i) => {
          const canZoom = !!item.children?.length
          const label = item.other ? t('disk.other', { count: item.fileCount }) : item.name
          const pct = node.sizeBytes ? (item.sizeBytes / node.sizeBytes) * 100 : 0
          return (
            <button
              key={`${item.name}-${i}`}
              className={`tile ${item.system ? 'tile--system' : ''} ${item.other ? 'tile--other' : ''}`}
              style={{ left: x, top: y, width: Math.max(0, w - 2), height: Math.max(0, h - 2), ['--h' as string]: hueOf(item.name || 'other') }}
              title={`${label} — ${formatBytes(item.sizeBytes, lng)} (${pct.toFixed(1)} %)${item.system ? ` · ${t('disk.system')}` : ''}`}
              disabled={!canZoom}
              onClick={() => canZoom && setPath([...path, item])}
            >
              {w > 70 && h > 34 && (
                <>
                  <span className="tile__name">{label}</span>
                  <span className="tile__size">{formatBytes(item.sizeBytes, lng)}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <p className="muted treemap-legend">
        <span className="legend-swatch legend-swatch--system" /> {t('disk.legendSystem')} · {t('disk.legendZoom')}
      </p>
    </div>
  )
}
