/**
 * Inline SVG icons — bundled so the module carries no icon-library dependency
 * (keeps it drop-in portable). Each takes a `className` for sizing/colour.
 */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
}

export function DatabaseIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  )
}

export function TableIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M3 10h18M3 14h18M12 6v12M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
    </svg>
  )
}

export function ViewIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M2.5 12C3.8 7.9 7.5 5 12 5s8.2 2.9 9.5 7c-1.3 4.1-5 7-9.5 7s-8.2-2.9-9.5-7z" />
    </svg>
  )
}

export function ColumnIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M7 7h10M7 12h10M7 17h6" />
    </svg>
  )
}

export function KeyIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10 13l9-9M17 6l2 2M14 9l2 2" />
    </svg>
  )
}

export function ChevronIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M9 5l7 7-7 7z" />
    </svg>
  )
}

export function SearchIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

export function MenuIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

export function DownloadIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
    </svg>
  )
}

export function SortIcon({ className, dir }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 5l4 5H8z" opacity={dir === 'asc' ? 1 : 0.3} />
      <path d="M12 19l-4-5h8z" opacity={dir === 'desc' ? 1 : 0.3} />
    </svg>
  )
}

export function LinkIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" />
    </svg>
  )
}

export function CheckIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function LockIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  )
}

export function TerminalIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  )
}

export function PlayIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export function WandIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M15 4V2M15 10V8M12 7h-2M20 7h-2M4 20l10-10M17 5l2 2" />
    </svg>
  )
}

export function EraserIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M4 15l6-6 8 8-3 3H9l-5-5zM10 21h10" />
    </svg>
  )
}

export function ClockIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function BookmarkIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z" />
    </svg>
  )
}

export function AlertIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4M12 17.5v.5" />
    </svg>
  )
}

export function TrashIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
    </svg>
  )
}

export function SaveIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M5 4h11l3 3v13a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" />
      <path d="M8 4v5h7V4M8 21v-6h8v6" />
    </svg>
  )
}

export function SunIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function MoonIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
    </svg>
  )
}

/** `scheme: auto` — a monitor, i.e. "whatever the app around me is doing". */
export function MonitorIcon({ className }) {
  return (
    <svg className={className} {...base}>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M9 20h6M12 16v4" />
    </svg>
  )
}
