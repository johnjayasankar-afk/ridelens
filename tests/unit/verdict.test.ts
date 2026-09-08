/**
 * The bottom line, and the things it is not allowed to say.
 *
 * The page returned a $58.43 cab and a $5.50 train and left the rider to spot
 * the difference. Saying it out loud is the easy part; saying it without
 * overclaiming is the part with rules, and these are the rules.
 */
import { describe, expect, it } from 'vitest';
import type { NormalizedQuote } from '@/domain/quote';
import { MATERIAL_SAVING_SHARE, tripVerdict } from '@/domain/verdict';
import { aOrAn, accessLabel, durationLabel } from '@/ui/TripVerdict';

function quote(over: Partial<NormalizedQuote>): NormalizedQuote {
  return {
    id: 'q1',
    provider: 'taxi',
    providerProductId: 'p',
    providerProductName: 'Metered taxi',
    normalizedCategory: 'TAXI',
    priceType: 'METERED_ESTIMATE',
    priceMinMinor: 5843,
    priceMaxMinor: 6093,
    displayPriceMinor: 5843,
    rankingPriceMinor: 5843,
    currency: 'USD',
    pickupEtaSeconds: null,
    tripDurationSeconds: null,
    distanceMeters: 32000,
    availability: 'UNKNOWN',
    source: 'public_rate_card',
    sourceMethod: 'PUBLISHED_TARIFF',
    accountContext: 'PUBLIC',
    receivedAt: new Date().toISOString(),
    providerTimestamp: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    freshness: 'LIVE',
    scheduledFor: null,
    bookingHandoff: null,
    confidenceClass: 'MEDIUM',
    metadata: {},
    ...over,
  } as NormalizedQuote;
}

const train = (over: Partial<NormalizedQuote> = {}) =>
  quote({
    id: 'train',
    provider: 'transit',
    normalizedCategory: 'TRANSIT',
    priceType: 'UPFRONT_QUOTE',
    priceMinMinor: 550,
    priceMaxMinor: 550,
    tripDurationSeconds: 2220,
    metadata: { boardStation: 'Chicago Union Station', boardAccessMeters: 1287 },
    ...over,
  });

const bike = (over: Partial<NormalizedQuote> = {}) =>
  quote({
    id: 'bike',
    provider: 'bikeshare',
    normalizedCategory: 'BIKE',
    priceType: 'ESTIMATE_RANGE',
    priceMinMinor: 430,
    priceMaxMinor: 580,
    tripDurationSeconds: 2040,
    metadata: { startStation: '20th & O St NW', startWalkMeters: 120 },
    ...over,
  });

describe('when there is a bottom line worth stating', () => {
  it('names the saving when another mode beats every car', () => {
    const v = tripVerdict([quote({})], [train()]);
    expect(v?.savingMinor).toBe(5843 - 550);
    expect(v?.winner.id).toBe('train');
    expect(v?.car.id).toBe('q1');
    expect(v?.boardStation).toBe('Chicago Union Station');
    expect(v?.boardAccessMeters).toBe(1287);
  });

  it('reads a bike’s own metadata, which uses different keys', () => {
    const v = tripVerdict([quote({})], [bike()]);
    expect(v?.boardStation).toBe('20th & O St NW');
    expect(v?.boardAccessMeters).toBe(120);
  });

  it('says nothing when the ride ranking already leads with the cheapest', () => {
    // A $4 cab against a $5.50 train: the page is already right.
    expect(tripVerdict([quote({ priceMinMinor: 400 })], [train()])).toBeNull();
  });

  it('says nothing when the saving is not worth interrupting for', () => {
    const car = quote({ priceMinMinor: 600 });
    const barely = train({ priceMinMinor: Math.ceil(600 * (1 - MATERIAL_SAVING_SHARE)) + 1 });
    expect(tripVerdict([car], [barely])).toBeNull();
    // A fifth off the same fare is worth saying.
    expect(tripVerdict([car], [train({ priceMinMinor: 400 })])).not.toBeNull();
  });

  it('says nothing when there is no other mode at all', () => {
    expect(tripVerdict([quote({})], [])).toBeNull();
    expect(tripVerdict([], [train()])).toBeNull();
  });

  it('never subtracts across currencies', () => {
    expect(tripVerdict([quote({ currency: 'USD' })], [train({ currency: 'CAD' })])).toBeNull();
  });

  it('never recommends an option nobody could take', () => {
    /*
     * The bike source marks a quote UNAVAILABLE when the station it named has
     * no bikes left. Announcing that as the cheapest way to travel would be
     * pointing at an empty rack.
     */
    expect(tripVerdict([quote({})], [bike({ availability: 'UNAVAILABLE' })])).toBeNull();
    expect(tripVerdict([quote({})], [train({ freshness: 'EXPIRED' })])).toBeNull();

    // And a car nobody could take must not become the baseline either, or the
    // saving is measured against a fare that is not on offer.
    const deadCar = quote({ id: 'dead', availability: 'UNAVAILABLE', priceMinMinor: 100 });
    const v = tripVerdict([deadCar, quote({ id: 'live' })], [train()]);
    expect(v?.car.id).toBe('live');
  });
});

describe('the words it is allowed to use', () => {
  /*
   * The first draft told a rider that a shared bike takes "34 min on the
   * timetable". Bikes do not run to one. Each mode gets the noun that is true
   * of it, and the two figures are never subtracted from one another.
   */
  it('does not put a train’s vocabulary on a bike', () => {
    // A bike quote already counts the walk at both ends, so nothing is added.
    expect(durationLabel('BIKE', 2040, 480, 120)).toBe(
      '34 min door to door, walk included, against 8 min by road.',
    );
  });

  /*
   * The Loop to O'Hare, which is the trip that exposed this. The train runs 37
   * minutes and Union Station is 1287 m away — about a sixteen-minute walk. The
   * line used to read "37 min on the timetable, against 44 min by road", from
   * which a reader concluded the train was seven minutes faster. It is sixteen
   * minutes slower. Both figures were true; the pair of them was not.
   */
  it('counts the walk to the platform, so the comparison beside it is real', () => {
    expect(durationLabel('TRANSIT', 2220, 2640, 1287)).toBe(
      'About 53 min all in — 37 on the timetable and about 16 walking to the platform, against 44 min by road.',
    );
  });

  it('adds up on the page', () => {
    const line = durationLabel('TRANSIT', 2220, 2640, 1287);
    const [, total, ride, walk] = /About (\d+) min all in — (\d+) on .* about (\d+) walking/.exec(
      line,
    )!;
    expect(Number(ride) + Number(walk)).toBe(Number(total));
  });

  it('drops a walk that rounds away rather than printing "about 0"', () => {
    expect(durationLabel('TRANSIT', 2220, 2640, 20)).toBe(
      '37 min on the timetable, against 44 min by road.',
    );
  });

  /*
   * Station matching reaches 8 km. Nobody walks that, so there is no total to
   * state — and with no total there is no honest comparison, so the road figure
   * goes rather than sitting next to a number that excludes four miles.
   */
  it('describes access it will not add, and withdraws the comparison with it', () => {
    const line = durationLabel('TRANSIT', 2220, 2640, 6_800);
    expect(line).toBe('37 min on the timetable, once you have covered the 4.2 mi to the station.');
    expect(line).not.toContain('by road');
  });

  it('stops at the platform when the distance to it is unknown', () => {
    expect(durationLabel('TRANSIT', 2220, 2640, null)).toBe(
      '37 min on the timetable, before getting to the platform.',
    );
  });

  it('omits the road figure rather than inventing one', () => {
    expect(durationLabel('TRANSIT', 2220, null, 20)).toBe('37 min on the timetable.');
    expect(durationLabel('TRANSIT', null, 2640, 1287)).toBe('');
  });

  it('says a bike is waiting and a train departs', () => {
    expect(accessLabel('BIKE', '20th & O St NW', 120)).toBe(
      'The nearest bike is at 20th & O St NW, a few steps from your pickup.',
    );
    expect(accessLabel('TRANSIT', 'Chicago Union Station', 1287)).toBe(
      'Leaves from Chicago Union Station, 0.8 mi from your pickup.',
    );
  });

  it('drops the distance rather than guessing it, and the whole clause with no station', () => {
    expect(accessLabel('TRANSIT', 'Union Station', null)).toBe('Leaves from Union Station.');
    expect(accessLabel('TRANSIT', null, 1287)).toBe('');
  });
});

describe('the article in front of a provider name', () => {
  it('picks the one the name actually takes', () => {
    expect(aOrAn('Licensed taxi')).toBe('a licensed taxi');
    expect(aOrAn('Uber')).toBe('an uber');
    expect(aOrAn('Empower')).toBe('an empower');
    expect(aOrAn('Lyft')).toBe('a lyft');
  });
});
