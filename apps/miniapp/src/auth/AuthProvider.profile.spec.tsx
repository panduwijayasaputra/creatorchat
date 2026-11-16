import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeMiniappApi,
  fakeSeen,
  fakeTelegram,
  nadia,
  networkError,
} from '../../test/fake-miniapp-api';
import { AuthProvider, useAuth } from './AuthProvider';

afterEach(cleanup);

function Probe({ onResult }: { onResult: (value: string) => void }) {
  const { state, updateProfile } = useAuth();
  if (state.status !== 'authenticated') return <p>menunggu</p>;
  return (
    <>
      <p data-testid="name">{state.user.display_name}</p>
      <button
        type="button"
        onClick={() => {
          updateProfile({ display_name: 'Nadia Baru', bio: 'halo' }).then(
            () => onResult('ok'),
            (error: unknown) => onResult(error instanceof Error ? error.name : 'error'),
          );
        }}
      >
        simpan
      </button>
    </>
  );
}

function mount(api: ReturnType<typeof createFakeMiniappApi>, onResult: (v: string) => void) {
  render(
    <AuthProvider api={api} telegram={fakeTelegram('query_id=1&hash=a')} seen={fakeSeen(true)}>
      <Probe onResult={onResult} />
    </AuthProvider>,
  );
}

describe('AuthProvider.updateProfile', () => {
  it('puts the saved account into the in-memory session', async () => {
    const api = createFakeMiniappApi();
    mount(api, () => undefined);
    expect(await screen.findByTestId('name')).toHaveTextContent('Nadia Putri');
    await userEvent.click(screen.getByRole('button', { name: 'simpan' }));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Nadia Baru'));
    expect(api.updateProfileCalls).toEqual([{ display_name: 'Nadia Baru', bio: 'halo' }]);
  });

  it('keeps the old account and throws to the caller when saving fails', async () => {
    const api = createFakeMiniappApi({ updateProfile: [networkError()] });
    const results: string[] = [];
    mount(api, (v) => results.push(v));
    await screen.findByTestId('name');
    await userEvent.click(screen.getByRole('button', { name: 'simpan' }));
    await waitFor(() => expect(results).toEqual(['NetworkError']));
    expect(screen.getByTestId('name')).toHaveTextContent(nadia.display_name);
  });
});
