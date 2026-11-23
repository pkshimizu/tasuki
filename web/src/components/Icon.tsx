/**
 * アイコン。docs/design/admin/ のデザインと同じ線画を使う。
 */
import type { Role } from "../../../src/config/config.js";
import type { Page } from "../routes.js";

export const ROLE_ICONS: Record<Role, string> = {
  dispatcher: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  "spec-master": "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  planner:
    "M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17",
  designer:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 9h18M9 9v11",
  programmer: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  reviewer:
    "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
};

export const MENU_ICONS: Record<Page, string> = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  requirements: "M5 21V4h12l-2 4 2 4H5",
  prs: "M6 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM6 7v10M6 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM18 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM18 17V9a3 3 0 0 0-3-3h-4M13 4l-2 2 2 2",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  questions:
    "M4 5h16v11H9l-5 4zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4M12 14.5v.01",
  product: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  system: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
};

export const ICONS = {
  clock: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4",
  merge:
    "M6 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM6 7v14M18 13a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM18 13c0-4-3-6-12-6",
  mergeWait:
    "M6 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM6 7v10M6 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM18 13a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM18 13c0-4-3-6-12-6",
  question:
    "M4 5h16v11H9l-5 4zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4M12 14.5v.01",
  external:
    "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  check: "M5 12l5 5L20 7",
  checkCircle: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12l3 3 5-6",
  spec: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  design:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 9h18M9 9v11",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  repo: "M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h14v-4M9 3v8l2-1.5L13 11V3",
  alert: "M12 4l9 16H3zM12 10v5M12 17.5v.01",
  flag: "M5 21V4h12l-2 4 2 4H5",
  chevronDown: "M6 9l6 6 6-6",
  chevronUp: "M6 15l6-6 6 6",
  blocked: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 8l8 8",
} as const;

export function Icon({
  d,
  size = 16,
  stroke = 1.8,
}: {
  d: string;
  size?: number;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** Tasuki のしるし（たすきを掛けた形） */
export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="var(--text)" />
      <path
        d="M7 9.5L20.5 23M11 5.5L22.5 17"
        stroke="var(--panel)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
