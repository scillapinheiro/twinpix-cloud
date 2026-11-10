import type { ReactNode } from 'react';

/** Os dois quadradinhos do logo (lima atrás, rosa à frente). */
export function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span className="logo-lime" />
      <span className="logo-pink" />
    </span>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 63 63" fill="none" aria-hidden="true">
      <path d="M13.07 32.67 24.83 44.43 49.65 19.6" stroke="currentColor" strokeWidth="8.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg viewBox="0 0 63 63" fill="none" aria-hidden="true">
      <path d="M15.68 15.68 47.04 47.04M47.04 15.68 15.68 47.04" stroke="currentColor" strokeWidth="8.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 27 27" fill="none" aria-hidden="true">
      <path d="M5.6 13.44h15.68M14.56 20.16l6.72-6.72-6.72-6.72" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const outline = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function WarningIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" {...outline}>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5z" />
      <path d="M12 10v4.5M12 17.4v.1" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" {...outline}>
      <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5z" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" {...outline}>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** "Foto gêmea": quadrado arredondado colorido com a silhueta de uma foto e o selo de fica/sai. */
export function TwinPhoto({ tone, mark, className }: { tone: 'lime' | 'pink' | 'white' | 'navy'; mark: 'check' | 'cross'; className?: string }): ReactNode {
  return (
    <span className={`twin-photo ${tone} ${className ?? ''}`} aria-hidden="true">
      <span className="hill hill-a" />
      <span className="hill hill-b" />
      <span className="seal">{mark === 'check' ? <CheckIcon /> : <CrossIcon />}</span>
    </span>
  );
}
