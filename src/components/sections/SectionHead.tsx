import type { ReactNode } from 'react';

type SectionHeadProps = {
  eyebrow: string;
  title: ReactNode;
  titleId?: string;
  lead?: ReactNode;
  /** Centre le bloc ; utilisé par la majorité des sections pleine largeur. */
  center?: boolean;
  /** Sur fond bleu, le sur-titre passe en or. */
  onBrand?: boolean;
};

/** Bloc d'introduction d'une section : sur-titre, titre, accroche. */
export default function SectionHead({
  eyebrow,
  title,
  titleId,
  lead,
  center = false,
  onBrand = false,
}: SectionHeadProps) {
  const eyebrowClass = [
    'eyebrow',
    center ? 'eyebrow--center' : '',
    onBrand ? 'eyebrow--light' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`section-head${center ? ' section-head--center' : ''} reveal`}>
      <p className={eyebrowClass}>{eyebrow}</p>
      <h2 id={titleId}>{title}</h2>
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  );
}
