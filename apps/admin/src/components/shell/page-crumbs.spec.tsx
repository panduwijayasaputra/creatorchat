import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageCrumbsProvider, usePageCrumbs, usePageCrumbsOverride } from './page-crumbs';

afterEach(cleanup);

function Show() {
  const crumbs = usePageCrumbsOverride();
  return <div data-testid="c">{crumbs ? crumbs.map((c) => c.label).join('/') : 'none'}</div>;
}
function Page({ name }: { name: string }) {
  usePageCrumbs([{ label: 'Creator', to: '/creators' }, { label: name }]);
  return null;
}

describe('page crumbs', () => {
  it('overrides while the page is mounted and clears afterwards', () => {
    const view = render(
      <PageCrumbsProvider>
        <Show />
        <Page name="Maya" />
      </PageCrumbsProvider>,
    );
    expect(screen.getByTestId('c')).toHaveTextContent('Creator/Maya');
    view.rerender(
      <PageCrumbsProvider>
        <Show />
      </PageCrumbsProvider>,
    );
    expect(screen.getByTestId('c')).toHaveTextContent('none');
  });

  it('is a no-op outside the shell', () => {
    render(<Page name="Maya" />);
  });
});
