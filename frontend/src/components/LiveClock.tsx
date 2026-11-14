import { useEffect, useState } from 'react';

const TIME = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DATE = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

/** La hora de Colombia, al segundo, con un punto vivo. Es solo informativa. */
export function LiveClock({ withDate = true }: { withDate?: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="live-clock" aria-hidden="true">
      <span className="live-dot" />
      {withDate && <span className="live-clock-date">{DATE.format(now)}</span>}
      <span className="live-clock-time">{TIME.format(now)}</span>
    </span>
  );
}
