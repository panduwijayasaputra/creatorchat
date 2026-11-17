import { useMemo, useState } from 'react';
import { Button, useToast } from '@creatorchat/ui';
import type { ApproveCreatorRequestResponse } from '@creatorchat/contracts';
import type { CreatorReviewApi } from '../auth/api-client';
import { ApproveRequestDialog } from '../creators/ApproveRequestDialog';
import { approvedBanner, rejectedToast } from '../creators/copy';
import { RejectRequestDialog } from '../creators/RejectRequestDialog';
import styles from './preview.module.css';
import { LUNA, MAYA, RAKA, SALSA_BLOCK, review } from './review-fixtures';

const SLOW_ID = '1a2b3c4d-1111-4222-8333-444455556666';

/** An in-memory review API: Maya is clear, Raka is blocked by a subscription, one approve never ends. */
function createPreviewApi(): CreatorReviewApi {
  const approved = (id: string): ApproveCreatorRequestResponse => ({
    request: { ...MAYA, id, status: 'APPROVED', reviewed_at: '2026-11-14T08:03:00.000Z' },
    creator: { id: '1b2f7f0e-7f0c-4a53-9d0c-2b3b5c1a9e44', public_code: 'k4m5x2qa' },
  });
  return {
    getCreatorRequest: async (id) => {
      if (id === RAKA.id) return review(RAKA, SALSA_BLOCK);
      if (id === LUNA.id) return review(LUNA);
      return review({ ...MAYA, id });
    },
    approveCreatorRequest: (id) =>
      id === SLOW_ID ? new Promise<never>(() => undefined) : Promise.resolve(approved(id)),
    rejectCreatorRequest: async (id, reason) => ({
      request: {
        ...LUNA,
        id,
        status: 'REJECTED',
        reviewed_at: '2026-11-14T08:03:00.000Z',
        review_reason: reason,
      },
    }),
  };
}

type Open = 'approve' | 'approve-slow' | 'approve-blocked' | 'reject' | null;

/** The creator review dialogs in their designed states (US-012). Not wired to any page yet. */
export function ReviewDialogsPreview() {
  const toast = useToast();
  const api = useMemo(createPreviewApi, []);
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const requestId =
    open === 'approve-slow' ? SLOW_ID : open === 'approve-blocked' ? RAKA.id : MAYA.id;

  return (
    <>
      <div className={styles.buttons}>
        <Button variant="outline" onClick={() => setOpen('approve')}>
          Setujui (Maya)
        </Button>
        <Button variant="outline" onClick={() => setOpen('approve-slow')}>
          Setujui (memproses)
        </Button>
        <Button variant="outline" onClick={() => setOpen('approve-blocked')}>
          Setujui (langganan aktif)
        </Button>
        <Button variant="outline" onClick={() => setOpen('reject')}>
          Tolak (Luna)
        </Button>
      </div>
      <ApproveRequestDialog
        requestId={requestId}
        open={open === 'approve' || open === 'approve-slow' || open === 'approve-blocked'}
        api={api}
        onClose={close}
        onDecided={(decision) =>
          toast.show({
            message:
              decision.kind === 'approved'
                ? approvedBanner(decision.response.request.creator_name)
                : 'Permintaan ini sudah ditinjau.',
          })
        }
      />
      <RejectRequestDialog
        requestId={LUNA.id}
        open={open === 'reject'}
        api={api}
        onClose={close}
        onDecided={(decision) =>
          toast.show({
            message:
              decision.kind === 'rejected'
                ? rejectedToast(decision.response.request.creator_name)
                : 'Permintaan ini sudah ditinjau.',
          })
        }
      />
    </>
  );
}
