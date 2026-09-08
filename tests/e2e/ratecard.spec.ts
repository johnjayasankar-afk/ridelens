/**
 * The credential-free path, end to end against a real browser.
 *
 * This project runs with NO fixture source and NO fixture geocoder: it is the
 * genuine out-of-the-box experience, hitting the live geocoder, the live
 * routing service and the published rate cards.
 */
import { expect, test, type Page } from '@playwright/test';

async function compare(page: Page, from: string, to: string) {
  await page.getByTestId('pickup-input').fill(from);
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await page.waitForTimeout(1200); // keyless geocoder self-throttles to ~1 req/s
  await page.getByTestId('destination-input').fill(to);
  await page.getByRole('option').first().click({ timeout: 25_000 });
  await page.getByTestId('compare-button').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows a live price with no credentials configured', async ({ page }) => {
  // No "no live source" banner: the rate card is a live source.
  await expect(page.getByTestId('no-live-source')).toHaveCount(0);

  await compare(page, 'Times Square New York', 'John F. Kennedy International Airport');
  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 40_000 });

  await expect(card).toHaveAttribute('data-provider', 'taxi');
  await expect(card.getByTestId('quote-price')).toContainText('$');
});

test('an airport flat fare is labelled upfront, not estimated', async ({ page }) => {
  await compare(page, 'Times Square New York', 'John F. Kennedy International Airport');
  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 40_000 });

  // $70 by rule, plus mandatory surcharges — an exact price, so UPFRONT.
  await expect(card).toHaveAttribute('data-price-type', 'UPFRONT_QUOTE');
  await expect(card.getByTestId('price-qualifier')).toContainText(/Upfront/i);
  const price = (await card.getByTestId('quote-price').textContent()) ?? '';
  expect(Number(price.replace(/[^0-9.]/g, ''))).toBeGreaterThan(70);
});

test('the detail sheet itemises the fare and cites the rate card', async ({ page }) => {
  await compare(page, 'Times Square New York', 'John F. Kennedy International Airport');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('inspect-button').first().click();
  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();

  await expect(sheet).toContainText('How this fare is built');
  await expect(sheet).toContainText(/flat fare/i);
  await expect(sheet).toContainText(/MTA State surcharge/i);
  await expect(sheet).toContainText('Official published rate card');
  // Provenance the reader can go and check.
  await expect(sheet.getByRole('link', { name: /Published rate card/i })).toBeVisible();
  // And the honest exclusions. Exactly one of these is true of any given
  // trip: either the routed line goes through a tolled crossing, in which case
  // that crossing is named and priced at the top of the band, or it does not,
  // in which case the sheet says tolls are excluded. Never both, never neither.
  const text = (await sheet.textContent()) ?? '';
  const namesAToll = /goes through (a tolled crossing|tolled crossings)/.test(text);
  const excludesTolls = /[Tt]olls and gratuity are not included/.test(text);
  expect(namesAToll || excludesTolls).toBe(true);
  expect(namesAToll && excludesTolls).toBe(false);
  if (namesAToll) {
    await expect(sheet).toContainText(/Tunnel|Bridge/);
    await expect(sheet).toContainText('Gratuity is not included.');
  }
});

test('a city trip is metered, never dressed up as an upfront fare', async ({ page }) => {
  await compare(page, 'Grand Central Terminal New York', 'Brooklyn Bridge New York');
  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 40_000 });

  // The meter decides, so this must never claim to be a binding fare. Whether
  // a band appears depends on live traffic, so the semantics are what is
  // asserted here; band rendering is pinned in the unit tests.
  await expect(card).toHaveAttribute('data-price-type', 'METERED_ESTIMATE');
  await expect(card.getByTestId('price-qualifier')).toContainText(/Metered/i);
});

test('says which markets it covers rather than guessing elsewhere', async ({ page }) => {
  // Denver, not Paris: "Eiffel Tower Paris" resolves to Paris, Tennessee on an
  // open geocoder, which tests route sanity rather than market coverage.
  await compare(page, 'Union Station Denver Colorado', 'Denver Art Museum Colorado');
  await expect(page.getByTestId('no-quotes')).toBeVisible({ timeout: 40_000 });

  const status = page.getByTestId('source-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/No published taxi rate card/i);
  await expect(status).toContainText(/New York City/);
  // Crucially: no price is shown for a market it cannot price.
  await expect(page.getByTestId('quote-price')).toHaveCount(0);
});

test('health reports live data available with no configuration', async ({ request }) => {
  const res = await request.get('/api/health');
  const body = await res.json();
  expect(body.liveDataAvailable).toBe(true);
  expect(body.liveSources).toContain('public_rate_card');
  expect(body.fixtureSourceActive).toBe(false);
});

test('offers a live shared-bike option, held out of the ride ranking', async ({ page }) => {
  await compare(page, 'Union Square New York', 'Washington Square Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  const bike = page.locator('[data-provider="bikeshare"]');
  await expect(bike).toHaveCount(1);
  await expect(bike).toContainText(/Citi Bike/i);
  await expect(bike.getByTestId('quote-price')).toContainText('$');

  // A different mode must not be allowed to win "cheapest ride".
  await expect(page.getByText(/Other ways to get there/i)).toBeVisible();
  const hero = page.getByTestId('quote-card').first();
  await expect(hero).not.toHaveAttribute('data-provider', 'bikeshare');
});

test('the bike detail names a real station and its live bike count', async ({ page }) => {
  await compare(page, 'Union Square New York', 'Washington Square Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  await page.locator('[data-provider="bikeshare"]').getByTestId('inspect-button').click();
  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();

  await expect(sheet).toContainText('Open real-time feed (GBFS)');
  await expect(sheet).toContainText(/Unlock \$/);
  // The quote is tied to a vehicle that is genuinely in the rack right now.
  await expect(sheet).toContainText(
    /This is the price for an? (e-bike|classic bike|bike), and \d+ (is|are) at .+ right now/,
  );
  // No booking link is claimed, because there is nowhere to send anyone.
  await expect(sheet).toContainText(/No link — arranged in person or in the operator app/i);
});

test('the map draws the route and the live stations along it', async ({ page }) => {
  await compare(page, 'Union Square New York', 'Washington Square Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  const map = page.getByTestId('route-map');
  await expect(map).toBeVisible();
  await expect(page.getByTestId('map-station-legend')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('map-station-legend')).toContainText(/\d+\/\d+ with bikes/i);
});

test('the map expands over the page and closes again', async ({ page }) => {
  await compare(page, 'Union Square New York', 'Washington Square Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('map-expand').click();
  // Expanded, it must sit above the results rather than behind them.
  const box = await page.getByTestId('route-map').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(500);

  // And the map has to actually fill it. MapLibre sizes its drawing buffer
  // once; when a fixed timeout was all that told it to resize, the expanded
  // map on a phone painted tiles across the top 250 pixels — the collapsed
  // height — and left the rest black. A ResizeObserver drives it now.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const canvas = document.querySelector('.maplibregl-canvas');
          const host = document.querySelector('.rl-map-canvas');
          if (!canvas || !host) return 0;
          const c = canvas.getBoundingClientRect();
          const h = host.getBoundingClientRect();
          if (h.height === 0) return 0;
          // Within the container's 1px border on each edge.
          return Math.abs(c.height - h.height) <= 3 && Math.abs(c.width - h.width) <= 3 ? 1 : 0;
        }),
      { timeout: 10_000, message: 'the map canvas does not fill its expanded container' },
    )
    .toBe(1);

  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await page.getByTestId('route-map').boundingBox())?.height ?? 0)
    .toBeLessThan(400);
});

test('the card and the detail sheet agree about whether you can book', async ({ page }) => {
  // These disagreed once. A taxi quote carries UNKNOWN availability — a rate
  // card knows the fare and nothing about where the cabs are — and the card
  // read that as "not stated" while the sheet read it as "no". The card offered
  // "How to ride" and the sheet, for the same quote, said "Not bookable right
  // now" and listed availability as "No vehicles right now".
  await compare(page, 'Times Square New York', 'John F. Kennedy International Airport');
  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 40_000 });

  const cardCta = await card.getByTestId('book-button').textContent();
  await card.getByTestId('inspect-button').click();
  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();

  const sheetCta = await sheet.getByTestId('detail-book').textContent();
  const bookableOnCard = cardCta?.trim() !== 'Unavailable';
  const bookableInSheet = sheetCta?.trim() !== 'Not bookable right now';
  expect(bookableInSheet).toBe(bookableOnCard);

  // And silence is reported as silence, never as an absence of cars.
  await expect(sheet).not.toContainText('No vehicles right now');
  await expect(sheet).toContainText('Not stated by this source');
});

test('names the covered cities before a route is entered', async ({ page }) => {
  // The first question a new rider has is "does this work where I am?", and it
  // is answerable before they type anything.
  await page.goto('/');
  const empty = page.getByTestId('empty-state');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('New York City');
  await expect(empty).toContainText('Philadelphia');
  await expect(empty).toContainText('Citi Bike');
});

test('a charge that only applies one way is only charged one way', async ({ page }) => {
  // SFMTA publishes a $6.00 SFO pick-up fee and states there is no drop-off
  // fee. This ran live against both directions and was wrong in one of them.
  await compare(page, 'San Francisco International Airport', 'Union Square San Francisco');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-provider="taxi"]').getByTestId('inspect-button').click();
  await expect(page.getByTestId('ride-detail')).toContainText('SFO airport pickup fee');
});

test('the party size is part of the price where a city charges for it', async ({ page }) => {
  await compare(page, 'Chicago Loop', "O'Hare International Airport");
  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  const solo = await card.getByTestId('quote-price').textContent();

  await page.getByTestId('party-4').click();
  // The re-price is debounced, then runs a fresh comparison.
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(4000);
  const four = await page
    .getByTestId('quote-card')
    .first()
    .getByTestId('quote-price')
    .textContent();
  expect(four).not.toBe(solo);
});

test('Copy puts the comparison on the clipboard, ranges intact', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await compare(page, 'Union Square New York', 'Washington Square Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('copy-summary').click();
  await expect(page.getByTestId('copy-summary')).toHaveText(/copied/i);

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Union Square');
  expect(text).toContain('Washington Square');
  // Certainty travels with the number, exactly as on screen.
  expect(text).toMatch(/upfront|metered estimate|estimated range|estimate/);
  expect(text).toContain('snapshot');
  expect(text).toContain('RideLens');
  // A range that reached the clipboard as a single number would undo the whole
  // product in one paste.
  for (const line of text.split('\n')) {
    if (line.includes('–')) expect(line).toMatch(/\$\d/);
  }
});

test('the detail sheet draws the whole day of a regulated fare', async ({ page }) => {
  await compare(page, 'Union Square New York', 'Washington Square Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-provider="taxi"]').getByTestId('inspect-button').click();
  await expect(page.getByTestId('ride-detail')).toBeVisible();

  const strip = page.getByTestId('fare-day');
  await expect(strip).toBeVisible();
  // New York varies across the day, so there is more than one band and one of
  // them is named the cheapest.
  await expect(strip).toContainText('cheapest');
  await expect(strip).toContainText(/\d{2}:\d{2}–\d{2}:\d{2}/);
  // Uppercased by CSS, lowercase in the DOM.
  await expect(strip).toContainText(/now/i);

  // The strip is a view of the same number as the headline, so the price on the
  // card has to appear among the bands. A band whose meter also charges for
  // slow time carries a trailing "+", which is the same figure.
  const headline = (await page.getByTestId('quote-price').first().textContent()) ?? '';
  const amount = headline.match(/\$[\d,]+(?:\.\d{2})?/)?.[0];
  expect(amount, 'no price on the card to compare against').toBeTruthy();
  await expect(strip).toContainText(amount!);
});

test('an uncovered city explains itself, even on a repeat search', async ({ page }) => {
  // The explanation lives on a source warning, and an empty result is the
  // reply most likely to be served from cache. It used to be dropped there.
  for (const attempt of [1, 2]) {
    await page.goto('/');
    await compare(page, 'Union Station Denver Colorado', 'Denver Art Museum Colorado');
    const status = page.getByTestId('source-status');
    await expect(status, `attempt ${attempt}`).toBeVisible({ timeout: 40_000 });
    await expect(status, `attempt ${attempt}`).toContainText(/no published taxi rate card/i);
    await expect(status, `attempt ${attempt}`).toContainText('New York City');
  }
});

/*
 * The bug a rider actually hit: a house in Scarsdale to an address in Chelsea
 * came back "No provider returned a price for this route." It is outside every
 * taxi jurisdiction, too far for a shared bike, and one of the most ordinary
 * journeys in the country. These run against the same live geocoder, the same
 * live routing and no credentials at all.
 */
test('a suburban pickup gets a price, not an empty screen', async ({ page }) => {
  await compare(page, '22 Murray Hill Road Scarsdale New York', '515 West 18th Street New York');

  const card = page.locator('[data-provider="transit"]').first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  await expect(card).toHaveAttribute('data-price-type', 'UPFRONT_QUOTE');
  await expect(card.getByTestId('quote-price')).toContainText('$');
  // The station, not a pickup ETA for a train nobody dispatched.
  await expect(card).toContainText(/Board at/i);
  // And no dead end.
  await expect(page.getByTestId('no-quotes')).toHaveCount(0);
});

test('the rail sheet names both stations and refuses to sound door-to-door', async ({ page }) => {
  await compare(page, '22 Murray Hill Road Scarsdale New York', '515 West 18th Street New York');
  await expect(page.locator('[data-provider="transit"]').first()).toBeVisible({ timeout: 40_000 });
  await page.locator('[data-provider="transit"]').getByTestId('inspect-button').first().click();

  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Boarding at');
  await expect(sheet).toContainText('Grand Central');
  await expect(sheet).toContainText(/not of the whole door-to-door trip/i);
  await expect(sheet).toContainText('Official published fare table');
  await expect(sheet.getByRole('link', { name: /Published fare table/i })).toBeVisible();
  // A train has no modelled seat count, and saying it does reads as a bug.
  await expect(sheet).not.toContainText('Typical seats');
});

/*
 * "When to go", against the live tariff.
 *
 * The invariant worth guarding is the one that broke: the day chart and the
 * headline price are two views of one number, and when they disagree there is
 * no way to tell from the screen which is lying. It happened because the chart
 * sampled "the next 16:00" and drew it on a clock face, splicing a holiday
 * together with the working day after it.
 */
test('the day chart agrees with the price on the card', async ({ page }) => {
  await compare(page, 'Union Square New York', 'John F. Kennedy International Airport');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  const planner = page.getByTestId('departure-planner');
  await expect(planner).toBeVisible();

  const card = (await page.getByTestId('quote-price').first().textContent()) ?? '';
  const now = (await planner.getByTestId('departure-price').first().textContent()) ?? '';
  const amount = (s: string) => s.replace(/[^0-9.]/g, '');
  expect(amount(now), 'the chart and the headline disagree about now').toBe(amount(card));
});

test('the timeline prices another departure without leaving the page', async ({ page }) => {
  await compare(page, 'Union Square New York', 'John F. Kennedy International Airport');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });

  const planner = page.getByTestId('departure-planner');
  await expect(planner.getByTestId('departure-advice')).not.toBeEmpty();

  // Reachable by keyboard, which is also the only way to scrub on a device
  // with no pointer.
  const scrub = planner.getByTestId('departure-scrub');
  await scrub.focus();
  await expect(scrub).toBeFocused();

  const before = await planner.getByTestId('departure-readout').textContent();
  for (let i = 0; i < 8; i += 1) await scrub.press('Shift+ArrowRight');
  await expect(planner.getByTestId('scrub-rule').first()).toBeVisible();
  await expect(planner.getByTestId('departure-readout')).toContainText(/^Leaving at \d{2}:\d{2}/);

  await scrub.press('Escape');
  await expect(planner.getByTestId('scrub-rule')).toHaveCount(0);
  await expect(planner.getByTestId('departure-readout')).toHaveText(String(before));
});

test('a taxi is not accused of failing to report a pickup time', async ({ page }) => {
  // A published rate card has no dispatch to ask, so "Pickup time unknown" is
  // an admission of ignorance about something nobody could have known.
  await compare(page, 'Union Square New York', 'John F. Kennedy International Airport');
  const card = page.locator('[data-provider="taxi"]').first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  await expect(card).not.toContainText('Pickup time unknown');
});

/*
 * Pricing a departure that has not happened yet.
 *
 * The airport run is the highest-stakes ride most people take and the one they
 * plan furthest ahead, and a published tariff prices it with the same
 * certainty as a trip leaving now. These run against the live geocoder, live
 * routing and no credentials at all.
 */
test('prices a chosen departure, and says which one', async ({ page }) => {
  await compare(page, 'Union Square New York', 'John F. Kennedy International Airport');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  const live = (await page.getByTestId('quote-price').first().textContent()) ?? '';

  await page.getByTestId('departure-open').click();
  // A weekday evening, when New York's $5.00 rush-hour surcharge is in force.
  const rush = new Date();
  rush.setDate(rush.getDate() + 2);
  while ([0, 6].includes(rush.getDay())) rush.setDate(rush.getDate() + 1);
  rush.setHours(17, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page
    .getByTestId('departure-input')
    .fill(
      `${rush.getFullYear()}-${pad(rush.getMonth() + 1)}-${pad(rush.getDate())}T${pad(rush.getHours())}:${pad(rush.getMinutes())}`,
    );
  await page.getByTestId('compare-button').click();

  await expect(page.getByTestId('scheduled-for')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('scheduled-for')).toContainText('Priced for');

  // A projection is not live, and there is nothing about it to expire.
  await expect(page.getByTestId('freshness').first()).toHaveText('Scheduled fare');
  await expect(page.getByTestId('live-toggle')).toHaveCount(0);

  // The rush-hour surcharge is real money, and the whole point of asking.
  const scheduled = (await page.getByTestId('quote-price').first().textContent()) ?? '';
  const amount = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
  expect(amount(scheduled)).toBeGreaterThan(amount(live));
});

test('a source that cannot see the future declines instead of guessing', async ({ page }) => {
  // Short enough for a bike, so the only reason to decline is the departure.
  await compare(page, 'Union Square New York', 'Bryant Park New York');
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('[data-provider="bikeshare"]')).toBeVisible();

  await page.getByTestId('departure-open').click();
  const later = new Date(Date.now() + 36 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page
    .getByTestId('departure-input')
    .fill(
      `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T${pad(later.getHours())}:${pad(later.getMinutes())}`,
    );
  await page.getByTestId('compare-button').click();

  await expect(page.getByTestId('scheduled-for')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('[data-provider="bikeshare"]')).toHaveCount(0);
  await expect(page.getByTestId('source-status')).toContainText(/live station counts/i);
});

test('a time taken off the chart re-prices the whole comparison', async ({ page }) => {
  await compare(page, 'Union Square New York', 'John F. Kennedy International Airport');
  await expect(page.getByTestId('departure-planner')).toBeVisible({ timeout: 40_000 });

  // Keyboard alone, which is also the only way to scrub without a pointer.
  const scrub = page.getByTestId('departure-scrub');
  await scrub.focus();
  for (let i = 0; i < 12; i += 1) await scrub.press('Shift+ArrowRight');

  // The pin survives leaving the track — without it the adopt button could
  // never be reached with a mouse.
  const adopt = page.getByTestId('departure-adopt');
  await expect(adopt).toBeVisible();
  await expect(adopt).toContainText(/Leave \d{2}:\d{2}/);
  await adopt.click();

  await expect(page.getByTestId('scheduled-for')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('departure-open')).not.toContainText('Leaving now');
});

/*
 * The first screen, which used to show nothing but prose about methodology.
 *
 * An example that returns no price is worse than no example: it demonstrates
 * the opposite of what it is there to demonstrate. These run the real path —
 * live geocoder, live routing, the city's own tariff — so they are also a
 * standing check that four representative trips still price at all.
 */
test('a first-time visitor can see a real fare in one tap', async ({ page }) => {
  await expect(page.getByTestId('example-trips')).toBeVisible();

  await page.getByTestId('example-nyc-jfk').click();

  const card = page.getByTestId('quote-card').first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  await expect(card).toHaveAttribute('data-provider', 'taxi');
  await expect(card.getByTestId('quote-price')).toContainText('$');

  // The fields are filled with the trip, so it can be edited into your own
  // rather than cleared and retyped.
  await expect(page.getByTestId('pickup-input')).toHaveValue(/Times Square/);
  await expect(page.getByTestId('destination-input')).toHaveValue(/JFK/);
});

test('the example that exists to show a refusal still shows one', async ({ page }) => {
  // No New York cab may pick up in Westchester. The taxi declines with the
  // rule and Metro-North answers instead — which is the whole point of
  // putting this trip on the front page.
  await page.getByTestId('example-mnr-scarsdale').click();

  await expect(page.locator('[data-provider="transit"]').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('source-status')).toContainText(/cannot pick up here/i);
  await expect(page.getByTestId('no-quotes')).toHaveCount(0);
});

test('every example trip comes back with a price', async ({ page }) => {
  for (const id of [
    'example-nyc-jfk',
    'example-dc-capitol',
    'example-mnr-scarsdale',
    'example-chi-ohare',
  ]) {
    await page.goto('/');
    await page.getByTestId(id).click();
    await expect(page.getByTestId('quote-card').first(), `${id} returned nothing`).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByTestId('no-quotes')).toHaveCount(0);
  }
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERDICT
 *
 * The Loop to O'Hare is the trip that made this component necessary: a $58
 * metered cab in the largest type on the page and a $5.50 train below it,
 * with nothing joining them up. These run against the live tariff and the live
 * Metra fare table, so they assert the *relationships* between the numbers on
 * screen rather than the numbers themselves, which change when a city files a
 * new rate card.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Every dollar amount in a string, in order, as numbers. */
function dollars(text: string): number[] {
  return [...text.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)/g)].map((m) => Number(m[1]));
}

test('the verdict names the cheaper mode and both prices', async ({ page }) => {
  await page.getByTestId('example-chi-ohare').click();
  const verdict = page.getByTestId('trip-verdict');
  await expect(verdict).toBeVisible({ timeout: 40_000 });

  await expect(verdict).toContainText(/by regional rail/i);
  await expect(verdict).toContainText(/less than a licensed taxi/i);
  // The boarding point is part of the deal, so it is never left out.
  await expect(verdict).toContainText(/Leaves from .*Station/i);

  // The hero is corrected in the same breath: it is the cheapest CAR, not the
  // only way to make the trip.
  await expect(page.getByTestId('card-headline').first()).toContainText(/only car/i);
});

test('the verdict’s own arithmetic holds', async ({ page }) => {
  await page.getByTestId('example-chi-ohare').click();
  const verdict = page.getByTestId('trip-verdict');
  await expect(verdict).toBeVisible({ timeout: 40_000 });

  const text = (await verdict.innerText()) ?? '';
  // Winner, saving, car — in the order the sentence says them.
  const [winner, saving, car] = dollars(text);
  expect(winner).toBeGreaterThan(0);
  expect(Number((car - winner).toFixed(2))).toBe(saving);
  // And it only speaks when the saving is worth interrupting for.
  expect(saving / car).toBeGreaterThanOrEqual(0.2);
});

/*
 * The defect this test exists for: the line read "37 min on the timetable,
 * against 44 min by road" for a train boarded 0.8 mi away. Both figures were
 * true and the pair of them was not — the walk is a quarter of an hour, and a
 * reader subtracting the two got the wrong winner. If a walkable access
 * distance is stated, the total that includes it must be stated too.
 */
test('the verdict counts the walk before comparing with the road', async ({ page }) => {
  await page.getByTestId('example-chi-ohare').click();
  const verdict = page.getByTestId('trip-verdict');
  await expect(verdict).toBeVisible({ timeout: 40_000 });

  const text = await verdict.innerText();
  const walkable = /(\d+(?:\.\d+)?) mi from your pickup/.exec(text);
  test.skip(walkable === null, 'no access distance published for this boarding point');

  if (Number(walkable![1]) * 1609.344 <= 2_000) {
    const parts = /About (\d+) min all in — (\d+) on the timetable and about (\d+) walking/.exec(
      text,
    );
    expect(parts, `no all-in total beside a walkable access distance: ${text}`).not.toBeNull();
    // It adds up on the page, so a reader who checks finds it holds.
    expect(Number(parts![2]) + Number(parts![3])).toBe(Number(parts![1]));
    // And the road figure is only ever set against the honest total.
    expect(Number(parts![1])).toBeGreaterThan(Number(parts![2]));
  } else {
    // Too far to walk, so there is no total — and with no total, no comparison.
    expect(text).toContain('once you have covered the');
    expect(text).not.toContain('by road');
  }
});

test('“Show it” opens the winning option, not the hero', async ({ page }) => {
  await page.getByTestId('example-chi-ohare').click();
  await expect(page.getByTestId('trip-verdict')).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('verdict-show').click();
  const sheet = page.getByTestId('ride-detail');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/Metra|regional rail/i);
  // Focus moves into the dialog rather than staying on the verdict behind it.
  // `contains` counts the dialog itself, which is where the sheet puts focus.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const d = document.querySelector('[data-testid="ride-detail"]');
          return d ? d.contains(document.activeElement) : false;
        }),
      { timeout: 5_000, message: 'opening the sheet from the verdict never moved focus into it' },
    )
    .toBe(true);
});

test('a trip whose cheapest option is already the hero says nothing extra', async ({ page }) => {
  // Times Square to JFK: the flat fare is the only way RideLens can price it,
  // so there is no bottom line to add and the banner stays away.
  await page.getByTestId('example-nyc-jfk').click();
  await expect(page.getByTestId('quote-card').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('trip-verdict')).toHaveCount(0);
});
