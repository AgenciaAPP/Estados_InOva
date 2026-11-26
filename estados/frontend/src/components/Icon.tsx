import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  id: <><rect x="2" y="5" width="20" height="14" rx="3"/><circle cx="8.5" cy="11" r="2"/><path d="M5 16c1-3 6-3 7 0m2-6h5m-5 4h4"/></>,
  list: <><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h1m3 0h4m-8 4h1m3 0h4m-8 4h1m3 0h4"/></>,
  flask: <><path d="M9 3h6m-5 0v6l-6 10a1.4 1.4 0 0 0 1.3 2h13.4a1.4 1.4 0 0 0 1.3-2L14 9V3M7.5 15h9"/></>,
  arrow: <path d="m9 6 6 6-6 6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.2"/></>,
  shield: <><path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5z"/><path d="m8.5 12 2.3 2.4 4.7-5"/></>,
  check: <path d="m5 12 4.5 4.5L19 7"/>,
  archive: <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9m-2-18 5 5v2m-5-7v5h5M6.5 12h4m-4 4h3"/><circle cx="17" cy="16" r="4"/><path d="m20 19 3 3"/></>,
}
export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
