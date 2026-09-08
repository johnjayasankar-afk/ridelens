'use client';

/**
 * The bottom line, said once, at the top.
 *
 * Only appears when the cheapest way to make the trip is not the one leading
 * the ride ranking — which is the case the rider would otherwise have to spot
 * for themselves, by scrolling past a card in the largest type on the screen.
 *
 * It states the saving and the catch in the same breath. A train is cheaper
 * *and* leaves from a station some distance away; presenting the first without
 * the second would be the kind of confident half-truth this product exists to
 * avoid. The two durations are reported side by side and never subtracted:
 * a railroad's scheduled run and a routing service's free-flow road estimate
 * measure different journeys, and one of them excludes the walk.
 */
import { providerProfile } from '@/config/providers';
import { formatMoney } from '@/domain/money';
import type { NormalizedCategory } from '@/domain/quote';
import type { TripVerdict as Verdict } from '@/domain/verdict';
import { minutesOf } from './format';
import { ProviderMark } from './ProviderMark';

interface Props {
  verdict: Verdict;
  /** Free-flow road time from the routing service, when it answered. */
  roadSeconds: number | null;
  /** Scrolls the winning card into view and opens its detail. */
  onShowWinner: () => void;
}

export function TripVerdict({ verdict, roadSeconds, onShowWinner }: Props) {
  const { winner, car, savingMinor } = verdict;
  const winnerName = providerProfile(winner.provider).displayName;
  const carName = providerProfile(car.provider).displayName;
  const mode = winner.normalizedCategory;
  const access = accessLabel(mode, verdict.boardStation, verdict.boardAccessMeters);
  const duration = durationLabel(
    mode,
    verdict.winnerSeconds,
    roadSeconds,
    verdict.boardAccessMeters,
  );

  return (
    <section
      data-testid="trip-verdict"
      aria-label="The cheapest way to make this trip"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-3) var(--sp-4)',
        borderRadius: 'var(--r-lg)',
        background: 'color-mix(in srgb, var(--best) 9%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--best) 30%, transparent)',
      }}
    >
      <span style={{ paddingTop: 'var(--sp-05)' }}>
        <ProviderMark provider={winner.provider} size={26} />
      </span>

      <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 'var(--sp-05)' }}>
        {/* The winning price gets real size. Stating the saving in a run of
            body text while the dearest option carried the largest number on the
            page meant a rider scanning by weight still read $58.43 first. */}
        <p
          className="tnum display"
          style={{
            margin: 0,
            fontSize: 'var(--t-2xl)',
            fontWeight: 680,
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            color: 'var(--best)',
          }}
        >
          {formatMoney(winner.priceMinMinor, winner.currency)}
        </p>

        <p
          style={{
            margin: 0,
            fontSize: 'var(--t-base)',
            lineHeight: 1.4,
            color: 'var(--text)',
          }}
        >
          by {winnerName.toLowerCase()} —{' '}
          <strong className="tnum" style={{ fontWeight: 660 }}>
            {formatMoney(savingMinor, winner.currency)} less
          </strong>{' '}
          than {aOrAn(carName)} at {formatMoney(car.priceMinMinor, car.currency)}.
        </p>

        <p
          style={{
            margin: 'var(--sp-05) 0 0',
            fontSize: 'var(--t-sm)',
            lineHeight: 1.5,
            color: 'var(--text-2)',
          }}
        >
          {access}
          {access && duration ? ' ' : ''}
          {/* Both figures, each labelled. Never the difference between them. */}
          {duration}
        </p>
      </div>

      <button
        type="button"
        data-testid="verdict-show"
        onClick={onShowWinner}
        className="rl-press rl-tap"
        style={{
          flex: '0 0 auto',
          alignSelf: 'center',
          padding: '0 var(--sp-3)',
          fontSize: 'var(--t-sm)',
          fontWeight: 620,
          fontFamily: 'var(--font-sans)',
          color: 'var(--text)',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-md)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Show it
      </button>
    </section>
  );
}

/**
 * A walking pace, in metres per second — about 3 mph.
 *
 * The ordinary planning figure for an unhurried adult on a pavement. It is an
 * assumption, and the copy says "about" every time it is used, because the
 * alternative is quietly excluding the walk altogether.
 */
export const WALK_METERS_PER_SECOND = 1.35;

/**
 * Past this, nobody is walking to the station and adding a walk would be fiction.
 *
 * Station matching reaches 8 km, which is a sensible radius for "there is a
 * railway near you" and an absurd one for "you will stroll to it". Beyond about
 * a mile and a quarter the access stops being a walk and becomes a second trip
 * this product cannot price, so it is described rather than added.
 */
export const WALKABLE_METERS = 2_000;

/** Metres as the miles a rider thinks in. */
function milesLabel(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.2 ? 'a few steps' : `${miles.toFixed(1)} mi`;
}

/**
 * The catch, in the same breath as the saving.
 *
 * A fare that starts at a station is not a fare that starts at the door, and
 * how far that is decides whether the saving is worth anything. A train leaves
 * from somewhere; a bike is waiting somewhere. Using one verb for both put
 * "leaves from" in front of a docking station, which is the sort of confidently
 * wrong word this product exists not to print.
 */
export function accessLabel(
  mode: NormalizedCategory,
  station: string | null,
  meters: number | null,
): string {
  if (!station) return '';
  const verb = mode === 'BIKE' ? 'The nearest bike is at' : 'Leaves from';
  if (meters === null) return `${verb} ${station}.`;
  return `${verb} ${station}, ${milesLabel(meters)} from your pickup.`;
}

/**
 * How long it takes — counted from the same doorstep as the number beside it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE COMPARISON WAS RIGGED BY OMISSION                                    │
 * │                                                                          │
 * │ This line used to read "37 min on the timetable, against 44 min by road" │
 * │ for a train boarded at a station 0.8 mi from the pickup. Both figures     │
 * │ were true and correctly attributed, and the sentence before it gave the  │
 * │ 0.8 mi. It was still misleading, because two numbers placed side by side │
 * │ get subtracted whatever the labels say — and the answer a reader got was │
 * │ backwards. The walk is sixteen minutes. The trip is about 53 against 44: │
 * │ the train is cheaper AND slower, and the page was implying otherwise.    │
 * │                                                                          │
 * │ Refusing to do the arithmetic is not the same as being honest about it.  │
 * │ So the walk goes in, at a stated pace, hedged with "about" — or, when    │
 * │ the boarding point is too far to walk to, the road figure comes out,     │
 * │ because there is no comparison left to make.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A bike is the exception: its quote is already door to door, because the
 * operator's own planner counts the walk to the dock and from the far one.
 */
export function durationLabel(
  mode: NormalizedCategory,
  winnerSeconds: number | null,
  roadSeconds: number | null,
  accessMeters: number | null,
): string {
  if (winnerSeconds === null) return '';
  const ride = minutesOf(winnerSeconds);
  const road = roadSeconds === null ? '' : `, against ${minutesOf(roadSeconds)} min by road`;

  if (mode === 'BIKE') return `${ride} min door to door, walk included${road}.`;

  // No distance means no defensible total, so the sentence stops rather than
  // implying the timetable is the whole journey.
  if (accessMeters === null) return `${ride} min on the timetable, before getting to the platform.`;

  if (accessMeters > WALKABLE_METERS) {
    return `${ride} min on the timetable, once you have covered the ${milesLabel(accessMeters)} to the station.`;
  }

  const walk = minutesOf(accessMeters / WALK_METERS_PER_SECOND);
  // A walk that rounds away changes nothing, and "plus 0 min" is noise.
  if (walk < 1) return `${ride} min on the timetable${road}.`;

  // The parts are summed after rounding so that they add up on the page; a
  // reader who checks the arithmetic should find it holds.
  return `About ${ride + walk} min all in — ${ride} on the timetable and about ${walk} walking to the platform${road}.`;
}

/**
 * "a licensed taxi", "an Uber" — the article the provider's own name takes.
 *
 * Provider display names are data, not a fixed list, so the sentence cannot
 * hard-code its article without eventually printing "a Uber".
 */
export function aOrAn(name: string): string {
  const lower = name.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}
