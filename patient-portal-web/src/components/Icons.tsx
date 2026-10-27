import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Decorative only: every icon is hidden from assistive technology and sits next to text.
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24",
} as const;

export function LogoIcon(props: IconProps) {
  return (
    <svg {...props} aria-hidden="true" focusable="false" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="var(--color-brand-600)" />
      <path
        d="M5 17h5l3-7 5 13 3-6h6"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props} aria-hidden="true" focusable="false">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props} aria-hidden="true" focusable="false">
      <path d="M12 4 3 20h18L12 4Z" />
      <path d="M12 10v4M12 17.2v.01" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
