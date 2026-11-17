import { instagramHandle, type CreatorDetail } from '@creatorchat/contracts';
import { Button, InfoCircleIcon, StatusChip } from '@creatorchat/ui';
import type { ReactNode } from 'react';
import { DETAIL_COPY } from '../copy';
import { formatDateWib } from '../format';
import styles from './creator-detail.module.css';

const TYPE_LABEL = { HUMAN: 'Creator Asli', AI_CHARACTER: 'Karakter AI' } as const;
const C = DETAIL_COPY;

function Row({ label, width, children }: { label: string; width?: number; children: ReactNode }) {
  return (
    <div className={styles.row} style={width ? ({ '--label': `${width}px` } as never) : undefined}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

/** `AdmCrReq`: the application and the pre-approval check. */
export function RequestSummary({ detail }: { detail: CreatorDetail }) {
  const request = detail.request;
  if (!request) return null;
  const block = request.subscription_block;
  return (
    <div className={styles.twoCols}>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{C.request.descriptionTitle}</h3>
        <p className={styles.text}>{request.description}</p>
        <Row label={C.request.name}>{detail.creator_name}</Row>
        <Row label={C.request.instagram}>
          {detail.instagram_url ? instagramHandle(detail.instagram_url) : '–'}
        </Row>
        <Row label={C.request.type}>{TYPE_LABEL[detail.creator_type]}</Row>
        <Row label={C.request.rights}>{C.request.rightsValue}</Row>
      </section>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{C.request.checkTitle}</h3>
        <Row label={C.request.subscription} width={180}>
          {block ? (
            <>
              <StatusChip status="request" label={C.gap.subscriptionCount(block.count)} />
              <div className={styles.caption}>
                {C.gap.subscriptionUntil(block.creator_name, formatDateWib(block.ends_at))}
              </div>
            </>
          ) : (
            <StatusChip status="active" label={C.request.none} />
          )}
        </Row>
        <Row label={C.request.role} width={180}>
          {request.user_role}
        </Row>
        <Row label={C.request.history} width={180}>
          {request.previous_rejections === 0
            ? C.request.first
            : C.gap.rejections(request.previous_rejections)}
        </Row>
        <div className={styles.note}>
          <InfoCircleIcon size={16} strokeWidth={2} />
          <span>{C.request.note}</span>
        </div>
      </section>
    </div>
  );
}

/** `AdmCrActive` / `AdmCrBlocked`. Data that does not exist yet shows "–"; Kategori / Kota are not stored. */
export function CreatorSummary({ detail }: { detail: CreatorDetail }) {
  const creator = detail.creator;
  if (!creator) return null;
  const copy = C.creator;
  const stats: [string, string][] = [
    [copy.subscribers, new Intl.NumberFormat('id-ID').format(creator.subscriber_count)],
    [copy.conversations, '–'],
    [copy.messages, '–'],
    [copy.media, '–'],
  ];
  return (
    <>
      <div className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <div className={styles.statLabel}>{label}</div>
            <div className={styles.statValue}>{value}</div>
          </div>
        ))}
      </div>
      <div className={`${styles.twoCols} ${styles.twoColsActive}`}>
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>{copy.bioTitle}</h3>
          <p className={styles.text}>{creator.bio ?? creator.description ?? '–'}</p>
          <Row label={copy.instagram}>
            {detail.instagram_url ? instagramHandle(detail.instagram_url) : '–'}
          </Row>
        </section>
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>{copy.aiTitle}</h3>
          <div className={styles.cardSub}>{copy.aiRange}</div>
          {copy.aiRows.map((label) => (
            <Row key={label} label={label} width={160}>
              –
            </Row>
          ))}
          <div style={{ marginTop: 8 }}>
            <Button variant="outline" disabled title={C.gap.inertUsage}>
              {copy.aiButton}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
