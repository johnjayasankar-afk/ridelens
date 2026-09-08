/**
 * The bottom line, across every mode.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PAGE KNEW THE ANSWER AND NEVER SAID IT                               │
 * │                                                                          │
 * │ The Loop to O'Hare returned a $58.43 cab and a $5.50 train. The cab was  │
 * │ the hero, in the largest type on the screen, under a badge reading ONLY  │
 * │ OPTION — which was false, and the train was a scroll below it under a    │
 * │ heading explaining that it had been kept out of the ranking. A rider had │
 * │ to do the comparison the product exists to do.                           │
 * │                                                                          │
 * │ Keeping other modes out of the *ranking* is right: a bike is almost      │
 * │ always cheapest and would win "cheapest ride" every time, turning a ride │
 * │ comparison into a mode comparison without saying so. But excluding a     │
 * │ mode from a ranking is not a reason to leave the rider to notice it.     │
 * │                                                                          │
 * │ WHAT THIS MAY AND MAY NOT CLAIM                                          │
 * │ • Price, freely: both fares are for the same two points.                 │
 * │ • Never that they are interchangeable. A train leaves from a station,    │
 * │   and the distance to it is part of the deal — so the verdict carries    │
 * │   that distance and the UI states it in the same breath as the saving.   │
 * │ • Never a time *comparison*. A railroad's scheduled run and a routing    │
 * │   service's free-flow road estimate are two different measurements of    │
 * │   two different journeys, and one of them excludes the walk. Both        │
 * │   figures are reported, each labelled with where it came from; the       │
 * │   subtraction is left undone because it would not mean anything.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { OTHER_MODES } from './taxonomy';
import type { NormalizedQuote } from './quote';
import { isBookable } from './ranking';

export interface TripVerdict {
  /** The cheapest option overall, which is not in the ride ranking. */
  winner: NormalizedQuote;
  /** The cheapest option that *is* in the ride ranking. */
  car: NormalizedQuote;
  /** How much less the winner costs, in minor units. Always > 0. */
  savingMinor: number;
  /** Where the winner is boarded, when it is not the rider's own doorstep. */
  boardStation: string | null;
  /** Metres from the pickup to that boarding point, when known. */
  boardAccessMeters: number | null;
  /** The winner's own scheduled duration, when its operator publishes one. */
  winnerSeconds: number | null;
}

/**
 * How much cheaper an alternative has to be before it is worth interrupting for.
 *
 * A dollar off a cab fare is noise — the rider chose a car for reasons a dollar
 * does not change. The threshold is a *share* rather than an amount because the
 * same dollar means different things against $6 and against $60; a fifth is
 * where "you could take the train instead" stops being pedantic.
 */
export const MATERIAL_SAVING_SHARE = 0.2;

/**
 * The one thing worth saying at the top of the results, or nothing.
 *
 * Returns null whenever the ride ranking already leads with the cheapest way to
 * make the trip, which is most of the time: a verdict that fires on every
 * comparison is a banner, and a banner is scrolled past.
 */
export function tripVerdict(
  ranked: readonly NormalizedQuote[],
  otherModes: readonly NormalizedQuote[],
): TripVerdict | null {
  /*
   * The same bar on both sides. Filtering only the car was a real defect: the
   * bike source marks a quote UNAVAILABLE when the station it named has no
   * bikes left in it, and an unfiltered winner would have announced "the
   * nearest bike is at 20th & O St, $9.16 less" about a bike that is not
   * there.
   */
  const car = cheapest(ranked.filter(isBookable));
  const winner = cheapest(
    otherModes.filter((q) => OTHER_MODES.has(q.normalizedCategory) && isBookable(q)),
  );
  if (!car || !winner) return null;

  // Never across currencies: the difference of two numbers in different money
  // is not a saving, it is a category error.
  if (car.currency !== winner.currency) return null;

  const savingMinor = car.priceMinMinor - winner.priceMinMinor;
  if (savingMinor <= 0) return null;
  if (savingMinor / Math.max(1, car.priceMinMinor) < MATERIAL_SAVING_SHARE) return null;

  return {
    winner,
    car,
    savingMinor,
    boardStation: str(winner.metadata.boardStation) ?? str(winner.metadata.startStation),
    boardAccessMeters:
      num(winner.metadata.boardAccessMeters) ?? num(winner.metadata.startWalkMeters),
    winnerSeconds: winner.tripDurationSeconds,
  };
}

function cheapest(quotes: readonly NormalizedQuote[]): NormalizedQuote | null {
  let best: NormalizedQuote | null = null;
  for (const q of quotes) {
    if (best === null || q.priceMinMinor < best.priceMinMinor) best = q;
  }
  return best;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
