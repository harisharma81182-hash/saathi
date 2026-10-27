import { useState } from 'react';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';

// Tasks finished per day over the last 14 days (GET /api/me/progress), as columns.
// One series, so no legend box: the title says what is plotted. Last week is a quieter step of the
// same colour, this week the full colour, each labelled underneath. Columns are thin with a rounded
// top and a square base; three hairline gridlines; only the highest day carries its number; every
// column shows its value on hover or keyboard focus; a hidden table gives the numbers to screen readers.

const BAR = '#21A895'; // checked with the dataviz validator against the night-sky surface (dark mode)

export function ProgressChart({ progress }) {
  const { series, thisWeek, lastWeek, change, streak } = progress;
  const [hover, setHover] = useState(null);
  const max = Math.max(...series.map((d) => d.completed), 0);
  const top = niceTop(max);
  const ticks = [0, top / 2, top];
  const best = series.reduce((b, d, i) => (d.completed > (series[b]?.completed ?? -1) ? i : b), -1);
  const today = series.length - 1;
  const label = (iso, i) => (i === today ? 'Aaj' : new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }));
  const long = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <section aria-labelledby="progress-title">
      <h2 id="progress-title" className="font-display text-xl font-semibold">
        Roz kitne kaam pure hue
      </h2>
      <p className="mt-1 text-sm text-faint">Pichhle 14 din</p>

      {/* The figures this chart is about */}
      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <dt className="text-sm text-faint">Is hafte</dt>
          <dd className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tabular-nums">{thisWeek}</span>
            {change !== 0 && (
              <span className="inline-flex items-center gap-1 text-sm text-muted">
                {change > 0 ? <TrendingUp size={14} className="text-leaf" aria-hidden /> : <TrendingDown size={14} className="text-faint" aria-hidden />}
                pichhle hafte se {change > 0 ? `${change} zyada` : `${-change} kam`}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-faint">Streak</dt>
          <dd className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tabular-nums">{streak}</span>
            <span className="inline-flex items-center gap-1 text-sm text-muted">
              <Flame size={14} className={streak >= 3 ? 'text-gold' : 'text-faint'} aria-hidden /> din lagatar
            </span>
          </dd>
        </div>
        {progress.focus && (
          <div>
            <dt className="text-sm text-faint">Focus</dt>
            <dd className="mt-0.5 flex items-baseline gap-2">
              <span className="font-display text-3xl font-semibold tabular-nums">{progress.focus.todayMinutes}</span>
              <span className="text-sm text-muted">min aaj, {Math.floor(progress.focus.weekMinutes / 60) ? `${Math.floor(progress.focus.weekMinutes / 60)}h ` : ''}{progress.focus.weekMinutes % 60} min is hafte</span>
            </dd>
          </div>
        )}
      </dl>

      {/* Plot */}
      <div className="mt-6 flex gap-3">
        <div aria-hidden className="flex h-40 w-6 flex-col justify-between pb-6 text-right text-xs text-faint tabular-nums">
          {[...ticks].reverse().map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none">
              {t}
            </span>
          ))}
        </div>
        <div className="relative h-40 flex-1">
          {/* gridlines */}
          <div aria-hidden className="absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <span key={t} className="h-px w-full bg-line" />
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 top-0 flex">
            {series.map((d, i) => {
              const h = top ? (d.completed / top) * 100 : 0;
              const thisWeekDay = i >= series.length - 7;
              return (
                <button
                  key={d.date}
                  type="button"
                  tabIndex={0}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${long(d.date)}: ${d.completed} kaam`}
                  className="group relative flex flex-1 flex-col items-center justify-end rounded-md"
                >
                  <span className="relative flex h-[calc(100%-1.5rem)] w-full items-end justify-center">
                    {i === best && d.completed > 0 && (
                      <span className="absolute text-xs text-muted tabular-nums" style={{ bottom: `calc(${h}% + 4px)` }}>
                        {d.completed}
                      </span>
                    )}
                    <span
                      className="block w-[min(24px,60%)] rounded-t-[4px] transition-[height,opacity] duration-500"
                      style={{ height: `${Math.max(h, d.completed ? 3 : 0)}%`, background: BAR, opacity: (thisWeekDay ? 1 : 0.42) * (hover === null || hover === i ? 1 : 0.6) }}
                    />
                    {!d.completed && <span className="block h-px w-[min(24px,60%)] bg-faint/40" />}
                  </span>
                  <span className={`h-6 pt-1.5 text-[11px] leading-none ${i === today ? 'font-semibold text-text' : 'text-faint'} ${i % 2 && i !== today ? 'max-sm:invisible' : ''}`}>{label(d.date, i)}</span>
                  {hover === i && (
                    <span className="glass pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink/90 px-2.5 py-1.5 text-xs text-text">
                      {long(d.date)}: <b className="tabular-nums">{d.completed}</b> kaam
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-9 mt-1 flex text-xs text-faint" aria-hidden>
        <span className="flex-1 border-t border-line pt-1.5">Pichhla hafta ({lastWeek})</span>
        <span className="flex-1 border-t pt-1.5" style={{ borderColor: BAR }}>
          Is hafta ({thisWeek})
        </span>
      </div>

      {/* The same numbers for screen readers */}
      <table className="sr-only">
        <caption>Pichhle 14 din mein roz pure hue kaam</caption>
        <thead>
          <tr>
            <th scope="col">Din</th>
            <th scope="col">Kaam</th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.date}>
              <th scope="row">{long(d.date)}</th>
              <td>{d.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A clean axis top: 2, 4, 6, 10, 20... at least the highest value. */
function niceTop(max) {
  if (max <= 2) return 2;
  if (max <= 4) return 4;
  if (max <= 6) return 6;
  if (max <= 10) return 10;
  return Math.ceil(max / 10) * 10;
}
