import type { ReactNode, SVGProps } from 'react';

type IconName =
  | 'book'
  | 'toc'
  | 'pen'
  | 'note'
  | 'note-plus'
  | 'chart'
  | 'settings'
  | 'search'
  | 'bookmark'
  | 'bookmark-filled'
  | 'arrow-left'
  | 'arrow-right'
  | 'close'
  | 'plus'
  | 'minus'
  | 'more'
  | 'sun'
  | 'moon'
  | 'type'
  | 'trash'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'clock'
  | 'folder'
  | 'import'
  | 'export'
  | 'layers'
  | 'image'
  | 'sparkles'
  | 'info'
  | 'keyboard'
  | 'quote'
  | 'expand'
  | 'play'
  | 'pause'
  | 'panel-left'
  | 'rotate-ccw'
  | 'home'
  | 'calendar'
  | 'target'
  | 'flame'
  | 'arrow-up-right';

const PATHS: Record<IconName, ReactNode> = {
  book: (
    <>
      <path d="M4 4.8A1.8 1.8 0 0 1 5.8 3H18a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H5.8A1.8 1.8 0 0 0 4 20.8V4.8Z" />
      <path d="M4 20.2A1.8 1.8 0 0 1 5.8 18.4H20" />
      <path d="M8 7.5h6" />
    </>
  ),
  toc: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.4" cy="6" r="1" />
      <circle cx="4.4" cy="12" r="1" />
      <circle cx="4.4" cy="18" r="1" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20h4L18.6 9.4a2.2 2.2 0 0 0-3.1-3.1L4.9 17v3Z" />
      <path d="M14.2 7.5l3.1 3.1" />
    </>
  ),
  note: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 11h6M9 15h4" />
    </>
  ),
  'note-plus': (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 11h6M12 14.5v4M10 16.5h4" />
    </>
  ),
  chart: (
    <>
      <path d="M3 20.5h18" />
      <rect x="5" y="11" width="3.6" height="7.6" rx="1.2" />
      <rect x="10.2" y="5.5" width="3.6" height="13.1" rx="1.2" />
      <rect x="15.4" y="14" width="3.6" height="4.6" rx="1.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h9.5M18.5 7.5h1.8M4 16.5h3.5M12.5 16.5h7.8" />
      <circle cx="16" cy="7.5" r="2.2" />
      <circle cx="10" cy="16.5" r="2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  bookmark: <path d="M6.4 4.6A1.6 1.6 0 0 1 8 3h8a1.6 1.6 0 0 1 1.6 1.6V21l-5.6-3.8L6.4 21V4.6Z" />,
  'bookmark-filled': (
    <path
      d="M6.4 4.6A1.6 1.6 0 0 1 8 3h8a1.6 1.6 0 0 1 1.6 1.6V21l-5.6-3.8L6.4 21V4.6Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  'arrow-left': <path d="M14.5 5.5 8 12l6.5 6.5" />,
  'arrow-right': <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  close: <path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  more: (
    <>
      <circle cx="5.2" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.8" cy="12" r="1.3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4 5.2 18.8" />
    </>
  ),
  moon: <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />,
  type: (
    <>
      <path d="M3 19 7.8 5.5 12.6 19M4.6 14.6h6.4" />
      <path d="M14.6 19l3.1-8 3.1 8M15.7 16.5h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.2 7l.9 12.1A1.9 1.9 0 0 0 9 21h6a1.9 1.9 0 0 0 1.9-1.9L17.8 7" />
      <path d="M10.3 11v5.6M13.7 11v5.6" />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 20 6.5" />,
  'chevron-down': <path d="M6 9.5 12 15.5 18 9.5" />,
  'chevron-right': <path d="M9.5 6 15.5 12 9.5 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3 1.9" />
    </>
  ),
  folder: (
    <path d="M3.2 7.2A1.8 1.8 0 0 1 5 5.4h3.6l1.9 2.4h8.5a1.8 1.8 0 0 1 1.8 1.8v8.2a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8V7.2Z" />
  ),
  import: (
    <>
      <path d="M12 3.5v10.8M8 10.6l4 4 4-4" />
      <path d="M4 16.5v2.2A1.8 1.8 0 0 0 5.8 20.5h12.4a1.8 1.8 0 0 0 1.8-1.8v-2.2" />
    </>
  ),
  export: (
    <>
      <path d="M12 14.3V3.5M8 7.4l4-4 4 4" />
      <path d="M4 16.5v2.2A1.8 1.8 0 0 0 5.8 20.5h12.4a1.8 1.8 0 0 0 1.8-1.8v-2.2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.2 20.5 8 12 12.8 3.5 8 12 3.2Z" />
      <path d="M3.5 12.6 12 17.4l8.5-4.8" />
      <path d="M3.5 16.6 12 21.4l8.5-4.8" />
    </>
  ),
  image: (
    <>
      <rect x="3.2" y="5" width="17.6" height="14" rx="2" />
      <circle cx="8.6" cy="10" r="1.5" />
      <path d="m4.4 17.6 4.6-4.6 3.6 3.6 3-3 4.2 4.2" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.4 13.7 8.3 18.6 10 13.7 11.7 12 16.6 10.3 11.7 5.4 10 10.3 8.3 12 3.4Z" />
      <path d="M18.4 15.4 19.2 17.8 21.6 18.6 19.2 19.4 18.4 21.8 17.6 19.4 15.2 18.6 17.6 17.8 18.4 15.4Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.4M12 8.1v.1" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2" />
      <path d="M6.4 10h.1M9.6 10h.1M12.8 10h.1M16 10h.1M19.2 10h.1M6.4 13.2h.1M9.6 13.2h.1M12.8 13.2h.1M16 13.2h.1M19.2 13.2h.1" />
      <path d="M8 15.8h8" />
    </>
  ),
  quote: (
    <>
      <path d="M9.4 6.4C6.8 7.6 5.2 9.9 5.2 12.6c0 2.6 1.4 4.4 3.5 4.4 1.9 0 3.2-1.3 3.2-3.1 0-1.8-1.2-3-2.9-3-.3 0-.6 0-.8.1.4-1.4 1.5-2.5 3-3.2L9.4 6.4Z" />
      <path d="M18.4 6.4C15.8 7.6 14.2 9.9 14.2 12.6c0 2.6 1.4 4.4 3.5 4.4 1.9 0 3.2-1.3 3.2-3.1 0-1.8-1.2-3-2.9-3-.3 0-.6 0-.8.1.4-1.4 1.5-2.5 3-3.2l-1.8-1.4Z" />
    </>
  ),
  expand: (
    <>
      <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />
    </>
  ),
  play: (
    <path d="M8 5.6v12.8L19 12 8 5.6Z" />
  ),
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  'rotate-ccw': (
    <>
      <path d="M3.5 4.5v5h5" />
      <path d="M4.2 9.2a8 8 0 1 1 .6 6.2" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.2 12 3.8l8 6.4V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9.8Z" />
      <path d="M9.2 21v-6.2h5.6V21" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M8 3.5v4M16 3.5v4M3.5 9.8h17" />
      <path d="M8 13.5h2M14 13.5h2M8 17h2M14 17h2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  flame: (
    <path d="M12 21c3.6 0 6.2-2.5 6.2-6 0-2.5-1.4-4.6-3.8-6.8-.6 1.8-1.6 3-3 3.8.2-3.4-1.3-6-4-7.8.2 2.6-1.6 4.4-2.8 6.4-.8 1.4-1.2 2.8-1.2 4.4 0 3.5 2.6 6 6.2 6H12Z" />
  ),
  'arrow-up-right': (
    <>
      <path d="M7 17 17 7" />
      <path d="M8.2 7H17v8.8" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, strokeWidth = 1.5, ...rest }: IconProps & { strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
