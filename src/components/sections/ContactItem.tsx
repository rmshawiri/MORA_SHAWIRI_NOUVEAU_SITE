import type { ReactNode } from 'react';

type ContactItemProps = {
  icon: ReactNode;
  title: string;
  text: string;
  href?: string;
  external?: boolean;
};

/**
 * Carte de coordonnée ou de réseau social.
 * Rendue en lien lorsqu'une destination est fournie, en bloc statique sinon.
 */
export default function ContactItem({ icon, title, text, href, external }: ContactItemProps) {
  const content = (
    <>
      <span className="contact-item__icon">{icon}</span>
      <span>
        <h3>{title}</h3>
        <p>{text}</p>
      </span>
    </>
  );

  if (!href) {
    return <div className="contact-item">{content}</div>;
  }

  return (
    <a
      className="contact-item"
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {content}
    </a>
  );
}
