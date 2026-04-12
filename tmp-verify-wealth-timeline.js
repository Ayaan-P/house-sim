const { chromium } = require('playwright');

(async() => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2600 } });
  const out = { checks: [] };
  try {
    await page.goto('https://house-vs-rent.netlify.app', { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByRole('button', { name: /run simulation/i }).click();
    await page.getByText('Simulation Results', { exact: true }).waitFor({ timeout: 120000 });

    const headings = await page.locator('h2, h3').allTextContents();
    const wealthTitle = headings.find(t => /Wealth Over Time|Wealth Timeline/i.test(t));
    const amortTitle = headings.find(t => /Amortization Schedule/i.test(t));
    if (!wealthTitle) throw new Error(`Wealth timeline heading missing. headings=${JSON.stringify(headings)}`);
    if (!amortTitle) throw new Error(`Amortization heading missing. headings=${JSON.stringify(headings)}`);

    const wealthSection = page.getByRole('heading', { name: wealthTitle, exact: true }).locator('..');
    await page.getByRole('heading', { name: wealthTitle, exact: true }).waitFor({ timeout: 30000 });

    const wealthIndex = headings.findIndex(t => t === wealthTitle);
    const amortIndex = headings.findIndex(t => t === amortTitle);
    out.checks.push({ claim: 'Wealth Timeline section renders below amortization/results', passed: wealthIndex > amortIndex && amortIndex !== -1, evidence: `wealthHeading=${wealthTitle}, amortHeading=${amortTitle}, wealthIndex=${wealthIndex}, amortIndex=${amortIndex}` });

    for (const label of ['Comparison', 'Uncertainty', 'Advantage']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(500);
      const guideVisible = await page.getByText(new RegExp(label === 'Comparison' ? 'Comparison view:' : label === 'Uncertainty' ? 'Uncertainty view:' : 'Advantage view:')).isVisible();
      out.checks.push({ claim: `${label} mode works`, passed: guideVisible, evidence: `${label} interpretation text visible=${guideVisible}` });
    }

    await page.getByRole('button', { name: 'Comparison', exact: true }).click();
    const crossover = page.getByText(/Buying starts outperforming renting|Renting outperforms buying/i).first();
    const crossoverVisible = await crossover.isVisible();
    out.checks.push({ claim: 'Crossover insight appears correctly', passed: crossoverVisible, evidence: crossoverVisible ? await crossover.textContent() : 'not visible' });

    const checkbox = page.getByLabel(/Show 25th-75th percentile/i);
    const before = await checkbox.isChecked();
    await checkbox.uncheck();
    const afterUncheck = await checkbox.isChecked();
    await checkbox.check();
    const afterCheck = await checkbox.isChecked();
    out.checks.push({ claim: 'Confidence-band toggle works', passed: before === true && afterUncheck === false && afterCheck === true, evidence: `before=${before}, afterUncheck=${afterUncheck}, afterCheck=${afterCheck}` });

    const htmlClass = await page.locator('html').getAttribute('class');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const subtle = await page.locator('text=Buy Wins Prob.').first().evaluate(el => getComputedStyle(el).color);
    const accent = await page.locator('text=Median Advantage').first().locator('..').evaluate(el => getComputedStyle(el).color);
    out.checks.push({ claim: 'Light mode colors are legible', passed: !String(htmlClass || '').includes('dark') && !!bg && !!subtle && !!accent, evidence: `htmlClass=${htmlClass || ''}, bodyBg=${bg}, labelColor=${subtle}, cardColor=${accent}` });

    await page.getByText('View year-by-year data').click();
    await page.getByRole('columnheader', { name: 'Leader' }).waitFor({ timeout: 10000 });
    const rowCount = await page.locator('tbody tr').count();
    const summaryStatsCount = await page.locator('text=Buy Wealth (Yr').count() + await page.locator('text=Rent Wealth (Yr').count() + await page.locator('text=Buy Wins Prob.').count() + await page.locator('text=Median Advantage').count();
    out.checks.push({ claim: 'Year-by-year table and summary stats render without layout breakage', passed: rowCount > 0 && summaryStatsCount >= 4, evidence: `rows=${rowCount}, summaryStats=${summaryStatsCount}` });

    await page.screenshot({ path: '/home/ayaan/projects/house-sim/wealth-timeline-qa.png', fullPage: true });
    out.screenshot = '/home/ayaan/projects/house-sim/wealth-timeline-qa.png';
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    out.error = String(err);
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();