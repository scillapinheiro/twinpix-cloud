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
