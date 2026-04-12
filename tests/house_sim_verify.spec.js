const { test, expect, devices } = require('playwright/test');

test('verify wealth timeline and leverage risk on live site', async ({ page, browser }) => {
  test.setTimeout(240000);
  await page.goto('https://house-vs-rent.netlify.app', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Run Simulation/i }).click();
  await expect(page.getByText('Simulation Results')).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(1500);

  await expect(page.getByText('📈 Wealth Over Time')).toBeVisible();
  await expect(page.getByText('⚖️ Leverage Risk')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comparison', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uncertainty', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Advantage', exact: true })).toBeVisible();
  await expect(page.getByText('Show 25th-75th percentile')).toBeVisible();
  await expect(page.getByText('Underwater risk')).toBeVisible();
  await expect(page.getByText('Margin of safety')).toBeVisible();
  await expect(page.getByText('Why leverage helps')).toBeVisible();
  await expect(page.getByText('Why leverage hurts')).toBeVisible();
  await expect(page.getByText('Starting LTV')).toBeVisible();
  await expect(page.getByText(/Median LTV/)).toBeVisible();
  await expect(page.getByText('First safer year')).toBeVisible();
  await expect(page.getByText('Low-cushion risk peak')).toBeVisible();

  await page.getByRole('button', { name: 'Uncertainty', exact: true }).click();
  await page.getByRole('button', { name: 'Advantage', exact: true }).click();
  await page.getByRole('button', { name: 'Comparison', exact: true }).click();

  const summary = page.locator('summary', { hasText: 'View year-by-year data' });
  await summary.click();
  await expect(page.getByRole('columnheader', { name: 'Buy (Median)' })).toBeVisible();

  const headings = await page.locator('h2, h3').allTextContents();
  const idxWealth = headings.findIndex(t => t.includes('📈 Wealth Over Time'));
  const idxLeverage = headings.findIndex(t => t.includes('⚖️ Leverage Risk'));
  const idxAmort = headings.findIndex(t => t.includes('📊 Amortization Schedule'));
  expect(idxWealth).toBeGreaterThan(-1);
  expect(idxLeverage).toBeGreaterThan(idxWealth);
  expect(idxAmort).toBeGreaterThan(idxLeverage);

  await page.evaluate(() => localStorage.setItem('house-sim-theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Run Simulation/i }).click();
  await expect(page.getByText('⚖️ Leverage Risk')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('html')).toHaveClass(/dark/);

  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const mobilePage = await context.newPage();
  await mobilePage.goto('https://house-vs-rent.netlify.app', { waitUntil: 'networkidle' });
  await mobilePage.getByRole('button', { name: /Run Simulation/i }).click();
  await expect(mobilePage.getByText('📈 Wealth Over Time')).toBeVisible({ timeout: 120000 });
  await expect(mobilePage.getByText('⚖️ Leverage Risk')).toBeVisible();
  await expect(mobilePage.getByText('📊 Amortization Schedule')).toBeVisible();
  await context.close();
});
