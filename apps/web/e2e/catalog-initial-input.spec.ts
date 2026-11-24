import { expect, test, type Page } from '@playwright/test';

const shows = ['NAMTANFILM Fan Meeting in Seoul', 'Girl Rules FAN MEETING IN SEOUL'].map((title, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  title, genre: 'concert', status: 'selling', posterUrl: null,
  startDate: '2027-02-13', endDate: '2027-02-13', venueName: 'Seoul',
}));

async function delayHydration(page: Page) {
  let release!: () => void;
  const interactionFinished = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/_next/static/**', async route => {
    if (route.request().resourceType() === 'script') {
      await Promise.all([interactionFinished, new Promise(resolve => setTimeout(resolve, 2600))]);
    }
    await route.continue();
  });
  return release;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/performances?**', route => {
    const sort = new URL(route.request().url()).searchParams.get('sort');
    return route.fulfill({ json: { data: sort === 'popular' ? [...shows].reverse() : shows, total: 2, page: 1, totalPages: 1 } });
  });
  await page.route('**/api/v1/search?**', route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    const data = shows.filter(show => query && show.title.includes(query));
    return route.fulfill({ json: { data, total: data.length, page: 1, totalPages: 1, query } });
  });
});

test('submits a search typed before the first scripts load', async ({ page }) => {
  const release = await delayHydration(page);
  try {
    await page.goto('/search', { waitUntil: 'commit' });
    const input = page.locator('main').getByRole('searchbox');
    await input.pressSequentially('NAMTANFILM', { delay: 65 });
    await input.press('Enter', { noWaitAfter: true });
  } finally { release(); }

  await expect(page).toHaveURL(/\/search\?q=NAMTANFILM$/);
  await expect(page.locator('main').getByRole('searchbox')).toHaveValue('NAMTANFILM');
  await expect(page.getByRole('heading', { name: shows[0].title, exact: true })).toBeVisible();
});

test('keeps the sort selected before hydration in the URL and the results', async ({ page }) => {
  const release = await delayHydration(page);
  const sort = page.getByRole('combobox', { name: '정렬 기준' });
  try {
    await page.goto('/categories', { waitUntil: 'commit' });
    await sort.selectOption('popular');
  } finally { release(); }

  await expect(page).toHaveURL(/\/categories\?sort=popular$/);
  await expect(sort).toHaveValue('popular');
  await expect(page.locator('main h3').first()).toHaveText(shows[1].title);
});
