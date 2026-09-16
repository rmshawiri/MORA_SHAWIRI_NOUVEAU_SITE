import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from '@/components/ui/Icon';
import { type Post, postPath } from '@/content/posts';

/** Carte d'article de blog. */
export default function PostCard({ post }: { post: Post }) {
  const href = postPath(post);

  return (
    <article className="card post-card">
      <Link href={href} tabIndex={-1} aria-hidden="true">
        <div className="post-card__media">
          <Image
            src={post.cover.src}
            alt={post.title}
            width={post.cover.width}
            height={post.cover.height}
            sizes="(max-width: 767px) 100vw, (max-width: 1080px) 50vw, 33vw"
            loading="lazy"
          />
        </div>
      </Link>
      <div className="post-card__body">
        <div className="post-card__meta">
          <span className="badge">{post.category}</span>
          <time dateTime={post.date}>{post.dateLabel}</time>
          <span>{post.readingTime}</span>
        </div>
        <h3>
          <Link href={href}>{post.title}</Link>
        </h3>
        <p>{post.excerpt}</p>
        <Link className="arrow-link" href={href}>
          Lire l’article <ArrowRight />
        </Link>
      </div>
    </article>
  );
}
