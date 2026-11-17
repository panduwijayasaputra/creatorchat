import { Link } from 'react-router';
import type { ExploreItem } from '@creatorchat/contracts';
import { creatorPath } from '@creatorchat/contracts';
import { Button, ChevronRightIcon, StatusChip } from '@creatorchat/ui';
import type { MiniappApi } from '../auth/api-client';
import { EXPLORE_COPY as C } from './explore-copy';
import styles from './explore.module.css';
import { useExplore } from './useExplore';

/** The disc colours the boards use for different people (background, letters). */
const PALETTE = [
  { bg: '#E6C3B5', fg: '#8E5B48' },
  { bg: '#F0D3B8', fg: '#8E6B48' },
  { bg: '#D8C4D8', fg: '#6B5578' },
] as const;

function paletteFor(code: string) {
  let sum = 0;
  for (const char of code) sum += char.charCodeAt(0);
  return PALETTE[sum % PALETTE.length] ?? PALETTE[0];
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase() || '?';

function Chip({ access }: { access: NonNullable<ExploreItem['access']> }) {
  if (access === 'ACTIVE') return <StatusChip status="active" label={C.chips.ACTIVE} />;
  if (access === 'PENDING') return <StatusChip status="pending" label={C.chips.PENDING} />;
  return <StatusChip status="expired" label={C.chips.EXPIRED} />;
}

function Card({ item }: { item: ExploreItem }) {
  const colour = paletteFor(item.public_code);
  return (
    <li className={styles.card}>
      <div
        className={styles.photo}
        style={{ background: colour.bg, color: colour.fg }}
        aria-hidden="true"
      >
        {item.avatar_url ? (
          <img src={item.avatar_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          initialsOf(item.display_name)
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.name}>{item.display_name}</div>
        {item.bio ? <div className={styles.bio}>{item.bio}</div> : null}
        <div className={styles.foot}>
          {item.access ? <Chip access={item.access} /> : null}
          <Link
            to={creatorPath(item.public_code)}
            className={styles.profile}
            aria-label={`${C.profile} ${item.display_name}`}
          >
            {C.profile}
            <ChevronRightIcon size={18} strokeWidth={2} />
          </Link>
        </div>
      </div>
    </li>
  );
}

/** `Explore` (`/explore`): ACTIVE creators with the viewer's own access chip; the server paginates. */
export function ExplorePage({ api }: { api: Pick<MiniappApi, 'listCreators'> }) {
  const { state, retry, loadMore } = useExplore(api);
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{C.title}</h1>
      {state.status === 'loading' ? (
        <p className={styles.message} role="status">
          {C.gap.loading}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className={styles.message} role="alert">
          <p>{C.gap.failed}</p>
          <Button variant="outline" onClick={retry}>
            {C.gap.retry}
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <p className={styles.message}>{C.gap.empty}</p>
      ) : null}
      {state.status === 'ready' && state.items.length > 0 ? (
        <>
          <ul className={styles.list} style={{ listStyle: 'none', padding: 0 }}>
            {state.items.map((item) => (
              <Card key={item.public_code} item={item} />
            ))}
          </ul>
          {state.items.length < state.total ? (
            <div className={styles.more}>
              <Button variant="outline" disabled={state.more === 'loading'} onClick={loadMore}>
                {state.more === 'loading' ? C.gap.loadingMore : C.gap.more}
              </Button>
              {state.more === 'failed' ? (
                <p className={styles.message} role="alert">
                  {C.gap.failed}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
