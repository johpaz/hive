import type { TickerEvent } from "./useEventFeed";

export function EventTicker({ events }: { events: TickerEvent[] }) {
  return (
    <div className="office3d-ticker">
      <div className="office3d-ticker-title">Actividad</div>
      <div className="office3d-ticker-list">
        {events.length === 0 && <div className="office3d-ticker-empty">Sin eventos todavía…</div>}
        {events.slice(0, 6).map((e) => (
          <div key={e.id} className={`office3d-ticker-item office3d-ticker-item--${e.kind}`}>
            <span className="office3d-ticker-dot" style={{ background: e.color }} />
            <span className="office3d-ticker-text">{e.text}</span>
            <span className="office3d-ticker-time">{e.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
