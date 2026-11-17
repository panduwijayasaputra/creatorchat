import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { AuditLogDetail } from '@creatorchat/contracts';
import { Button, ChevronLeftIcon, InfoCircleIcon, StatusChip } from '@creatorchat/ui';
import { ApiError, type CreatorDetailApi } from '../auth/api-client';
import { LOG_COPY as C } from '../creators/copy';
import { formatFullWib } from '../creators/format';
import styles from './log-detail.module.css';

type State =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; log: AuditLogDetail };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

const lines = (items: AuditLogDetail['before']) =>
  items.length === 0 ? C.noChanges : items.map((l) => `${l.label}: ${l.value}`).join('\n');

/** `/logs/:id` (`AdmLogDetail`): one audit entry, allowlisted fields only. */
export function LogDetailPage({ api }: { api: Pick<CreatorDetailApi, 'getAuditLog'> }) {
  const { id = '' } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: string; label?: string } | null) ?? null;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.getAuditLog(id, controller.signal).then(
      (log) => {
        if (!controller.signal.aborted) setState({ status: 'ready', log });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'not_found' }
            : { status: 'error' },
        );
      },
    );
    return () => controller.abort();
  }, [api, id, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const back = (
    <Link to={from?.from ?? '/logs'} className={styles.back}>
      <ChevronLeftIcon size={16} strokeWidth={2} />
      {from?.from ? from.label : C.back}
    </Link>
  );

  if (state.status === 'loading') {
    return (
      <>
        {back}
        <div className={styles.state} role="status">
          Memuat…
        </div>
      </>
    );
  }
  if (state.status === 'not_found') {
    return (
      <>
        {back}
        <div className={styles.state}>
          <h2 className={styles.title}>{C.notFoundTitle}</h2>
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        {back}
        <div className={styles.state} role="alert">
          <p>{C.loadFailed}</p>
          <Button variant="outline" onClick={retry}>
            {C.retry}
          </Button>
        </div>
      </>
    );
  }

  const { log } = state;
  return (
    <>
      {back}
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.title}>{C.summaryTitle}</h2>
          <Row label={C.fullTime}>{formatFullWib(log.at)}</Row>
          <Row label={C.actor}>{log.actor}</Row>
          <Row label={C.kind}>{log.action}</Row>
          <Row label={C.target}>{log.target}</Row>
          <Row label={C.status}>
            <StatusChip status={log.status} />
          </Row>
          <Row label={C.summary}>{log.summary || '–'}</Row>
          {log.reason ? <Row label={C.reason}>{log.reason}</Row> : null}
          {log.request_id ? (
            <Row label={C.requestId}>
              <span className={styles.mono}>{log.request_id}</span>
            </Row>
          ) : null}
        </section>
        <section className={styles.card}>
          <h2 className={styles.title}>{C.changesTitle}</h2>
          <div className={styles.panels}>
            <div className={`${styles.panel} ${styles.before}`}>
              <div className={styles.panelLabel}>{C.before}</div>
              <div className={styles.panelText}>{lines(log.before)}</div>
            </div>
            <div className={`${styles.panel} ${styles.after}`}>
              <div className={styles.panelLabel}>{C.after}</div>
              <div className={styles.panelText}>{lines(log.after)}</div>
            </div>
          </div>
          <div className={styles.note}>
            <InfoCircleIcon size={16} strokeWidth={2} />
            <span>{C.privacy}</span>
          </div>
        </section>
      </div>
      <div className={styles.footer}>
        <div className={styles.note}>
          <InfoCircleIcon size={16} strokeWidth={2} />
          <span>{C.immutable}</span>
        </div>
      </div>
    </>
  );
}
