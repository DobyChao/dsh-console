import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

const s = {
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function PlayIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M8 6.2v11.6L18.5 12z" {...s} />
    </Svg>
  );
}

export function FolderIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M3.8 7.2h5.1l1.7 1.8h9.6V18.2H3.8z" {...s} />
    </Svg>
  );
}

export function PuzzleIcon(props: Props) {
  return (
    <Svg {...props}>
      <path
        d="M10 4.5c0 1.1.9 2 2 2s2-.9 2-2h2.5A1.5 1.5 0 0 1 18 6v2.5c1.1 0 2 .9 2 2s-.9 2-2 2V15a1.5 1.5 0 0 1-1.5 1.5H14c0-1.1-.9-2-2-2s-2 .9-2 2H7.5A1.5 1.5 0 0 1 6 15v-2.5c-1.1 0-2-.9-2-2s.9-2 2-2V6A1.5 1.5 0 0 1 7.5 4.5z"
        {...s}
      />
    </Svg>
  );
}

export function GearIcon(props: Props) {
  return (
    <Svg {...props}>
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"
        {...s}
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        {...s}
      />
    </Svg>
  );
}

export function CheckIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7.5" {...s} />
      <path d="M8.6 12.2 11 14.6l4.4-5" {...s} />
    </Svg>
  );
}

export function AlertIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M12 4.8 20.2 19.2H3.8z" {...s} />
      <path d="M12 10v4" {...s} />
      <path d="M12 16.4h.01" {...s} />
    </Svg>
  );
}

export function RefreshIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" {...s} />
      <path d="M3 3v5h5" {...s} />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" {...s} />
      <path d="M16 16h5v5" {...s} />
    </Svg>
  );
}

export function ExternalLinkIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M14 5.5h4.5V10" {...s} />
      <path d="M10.5 13.5 18.5 5.5" {...s} />
      <path d="M16.5 13.2v5.3H5.5V7.5h5.3" {...s} />
    </Svg>
  );
}
