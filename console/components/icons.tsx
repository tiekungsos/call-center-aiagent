import type { SVGProps } from 'react';

/** ไอคอนชุดเดียว เส้น 1.6px มุมโค้งเดียวกันทั้งหมด (ไม่ใช้ emoji/ยูนิโค้ดแทนไอคอน) */
const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconPulse = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 12h3.5l2-6 3.5 12 2.5-8 1.5 4H21" />
  </svg>
);

export const IconCalls = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 4h3l1.6 4-2 1.4a12 12 0 0 0 5.6 5.6L14.6 13 19 15v3a1.6 1.6 0 0 1-1.8 1.6A15.4 15.4 0 0 1 3.4 5.8 1.6 1.6 0 0 1 5 4Z" />
  </svg>
);

export const IconAgent = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M12 4v3M9 13h.01M15 13h.01M9.5 16h5" />
  </svg>
);

export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.6H4Z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.6H20Z" />
  </svg>
);

export const IconInbox = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 13h4l1.2 2h5.6L16 13h4" />
    <path d="M5.5 5h13l1.5 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4Z" />
  </svg>
);

export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 4 3.5 10.5l6 2.2 2.2 6Z" />
    <path d="M20 4l-9.5 8.7" />
  </svg>
);

export const IconSliders = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 8h9M18 8h1M5 16h3M12 16h7" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="10" cy="16" r="2" />
  </svg>
);

export const IconArrow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12h13M13 7l5 5-5 5" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12.5 9.5 17 19 7" />
  </svg>
);
