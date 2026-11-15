import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthStatus } from './HealthStatus';

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('HealthStatus', () => {
  it('shows the API as ok when health is ok', async () => {
    mockFetch(() => json({ status: 'ok', checks: { db: 'up', redis: 'up' } }));
    render(<HealthStatus baseUrl="http://api.test" />);
    expect(await screen.findByText(/API: ok/)).toBeTruthy();
  });

  it('shows degraded details on a 503 health response', async () => {
    mockFetch(() => json({ status: 'degraded', checks: { db: 'down', redis: 'up' } }, 503));
    render(<HealthStatus baseUrl="http://api.test" />);
    expect(await screen.findByText(/API: degraded \(database down/)).toBeTruthy();
  });

  it('shows "API unreachable" on a network error without crashing', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<HealthStatus baseUrl="http://api.test" />);
    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });

  it('shows "API unreachable" when the body is not a health response', async () => {
    mockFetch(() => json({ unexpected: true }));
    render(<HealthStatus baseUrl="http://api.test" />);
    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });

  it('requests /v1/health on the configured base URL', async () => {
    mockFetch(() => json({ status: 'ok', checks: { db: 'up', redis: 'up' } }));
    render(<HealthStatus baseUrl="http://api.test/" />);
    await screen.findByText(/API: ok/);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://api.test/v1/health');
  });
});
