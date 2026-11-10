interface Props {
  /** 0 a 100. */
  percent: number;
  /** Nome acessível da barra, por exemplo "Progresso da análise". */
  label: string;
}

export function ProgressBar({ percent, label }: Props) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}
