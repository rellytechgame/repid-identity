import { useId } from 'react'

/** RePID Identity mark: a process tree inside a hexagon, with the root targeted. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="RePID Identity">
      <defs>
        <linearGradient id={id} x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path d="M32 5.5 55 18.75v26.5L32 58.5 9 45.25v-26.5Z" fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth="5" strokeLinejoin="round" />
      <circle cx="32" cy="21" r="8.5" fill="none" stroke="#fff" strokeOpacity=".65" strokeWidth="2" strokeDasharray="9.6 3.75" transform="rotate(-81 32 21)" />
      <path
        d="M32 29.5V35M20 42v-3.5a3.5 3.5 0 0 1 3.5-3.5h17a3.5 3.5 0 0 1 3.5 3.5V42M32 35v7"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="21" r="4.2" fill="#fff" />
      <rect x="16.5" y="42" width="7" height="7" rx="2" fill="#fff" fillOpacity=".92" />
      <rect x="28.5" y="42" width="7" height="7" rx="2" fill="#fff" fillOpacity=".92" />
      <rect x="40.5" y="42" width="7" height="7" rx="2" fill="#fff" fillOpacity=".92" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <strong>RePID</strong> <span>Identity</span>
    </span>
  )
}
