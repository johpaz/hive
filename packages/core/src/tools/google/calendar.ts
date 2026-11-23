/**
 * Google Calendar: consultar, crear, modificar y borrar eventos; disponibilidad.
 *
 * @category google
 * @spanish calendario, agenda, evento, reunión, cita, disponibilidad
 */
import { googleJson } from "../../google/client.ts";
import { CONFIRMED_PARAM, googleTool, needsConfirmation, num, str } from "./shared.ts";

const API = "https://www.googleapis.com/calendar/v3";
const cal = (p: Record<string, unknown>) => encodeURIComponent(str(p.calendar_id) ?? "primary");

function slim(e: any) {
  return {
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    location: e.location,
    description: e.description?.slice(0, 500),
    attendees: (e.attendees ?? []).map((a: any) => ({ email: a.email, status: a.responseStatus })),
    meet_link: e.hangoutLink,
    link: e.htmlLink,
    status: e.status,
  };
}

/** Acepta "2026-12-01T10:00:00-05:00" (con zona) o fecha sin hora (evento de día completo). */
function when(value: string, timeZone?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: value }
    : { dateTime: value, ...(timeZone ? { timeZone } : {}) };
}

const ISO = "ISO 8601. Prefer an explicit offset (2026-12-01T10:00:00-05:00); a bare date creates an all-day event.";

export const gcalListEventsTool = googleTool({
  name: "gcal_list_events",
  description:
    "List Google Calendar events in a time range (default: the next 7 days). Spanish: ver agenda, qué tengo hoy, próximos eventos, reuniones de la semana",
  parameters: {
    type: "object",
    properties: {
      time_min: { type: "string", description: `Range start. ${ISO} Default: now.` },
      time_max: { type: "string", description: `Range end. ${ISO} Default: +7 days.` },
      query: { type: "string", description: "Free-text filter." },
      calendar_id: { type: "string", description: "Default: primary." },
      max_results: { type: "number", minimum: 1, maximum: 50, description: "Default 20." },
    },
  },
  run: async (p, { userId }) => {
    const now = Date.now();
    const data = await googleJson<any>(userId, "calendar", `${API}/calendars/${cal(p)}/events`, {
      query: {
        timeMin: str(p.time_min) ?? new Date(now).toISOString(),
        timeMax: str(p.time_max) ?? new Date(now + 7 * 864e5).toISOString(),
        q: str(p.query),
        maxResults: num(p.max_results, 20, 1, 50),
        singleEvents: true,
        orderBy: "startTime",
      },
    });
    const events = (data.items ?? []).map(slim);
    return { ok: true, count: events.length, time_zone: data.timeZone, events };
  },
});

export const gcalCreateEventTool = googleTool({
  name: "gcal_create_event",
  description:
    "Create a Google Calendar event. If it has attendees, Google emails them invitations, so the first call returns needs_confirmation; repeat with confirmed=true after the user approves. " +
    "Spanish: agendar reunión, crear evento, programar cita, invitar asistentes",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Event title." },
      start: { type: "string", description: ISO },
      end: { type: "string", description: ISO },
      time_zone: { type: "string", description: "IANA zone, e.g. America/Bogota. Needed only when start/end have no offset." },
      description: { type: "string" },
      location: { type: "string" },
      attendees: { type: "array", items: { type: "string" }, description: "Attendee emails." },
      add_meet: { type: "boolean", description: "Attach a Google Meet link." },
      calendar_id: { type: "string" },
      confirmed: CONFIRMED_PARAM,
    },
    required: ["summary", "start", "end"],
  },
  run: async (p, { userId }) => {
    const summary = str(p.summary), start = str(p.start), end = str(p.end);
    if (!summary || !start || !end) return { ok: false, error: "summary, start y end son obligatorios." };
    const attendees = Array.isArray(p.attendees) ? p.attendees.filter((a): a is string => typeof a === "string" && a.includes("@")) : [];
    if (attendees.length) {
      const pending = needsConfirmation(p, { summary, start, end, attendees, location: str(p.location) });
      if (pending) return pending;
    }
    const tz = str(p.time_zone);
    const body: Record<string, unknown> = {
      summary,
      start: when(start, tz),
      end: when(end, tz),
      description: str(p.description),
      location: str(p.location),
      attendees: attendees.map((email) => ({ email })),
    };
    if (p.add_meet === true) {
      body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
    }
    const ev = await googleJson<any>(userId, "calendar", `${API}/calendars/${cal(p)}/events`, {
      method: "POST",
      query: { conferenceDataVersion: p.add_meet === true ? 1 : undefined, sendUpdates: attendees.length ? "all" : "none" },
      body,
    });
    return { ok: true, event: slim(ev) };
  },
});

export const gcalUpdateEventTool = googleTool({
  name: "gcal_update_event",
  description:
    "Modify fields of an existing Google Calendar event (only the ones provided). Needs user confirmation (needs_confirmation, then confirmed=true). Spanish: mover reunión, cambiar evento, reprogramar cita",
  parameters: {
    type: "object",
    properties: {
      event_id: { type: "string" },
      summary: { type: "string" },
      start: { type: "string", description: ISO },
      end: { type: "string", description: ISO },
      time_zone: { type: "string" },
      description: { type: "string" },
      location: { type: "string" },
      calendar_id: { type: "string" },
      confirmed: CONFIRMED_PARAM,
    },
    required: ["event_id"],
  },
  run: async (p, { userId }) => {
    const id = str(p.event_id);
    if (!id) return { ok: false, error: "event_id es obligatorio." };
    const tz = str(p.time_zone);
    const patch: Record<string, unknown> = {};
    for (const k of ["summary", "description", "location"] as const) if (str(p[k]) !== undefined) patch[k] = str(p[k]);
    if (str(p.start)) patch.start = when(str(p.start)!, tz);
    if (str(p.end)) patch.end = when(str(p.end)!, tz);
    if (!Object.keys(patch).length) return { ok: false, error: "No hay ningún campo para modificar." };
    const pending = needsConfirmation(p, { event_id: id, changes: patch });
    if (pending) return pending;
    const ev = await googleJson<any>(userId, "calendar", `${API}/calendars/${cal(p)}/events/${encodeURIComponent(id)}`, {
      method: "PATCH", query: { sendUpdates: "all" }, body: patch,
    });
    return { ok: true, event: slim(ev) };
  },
});

export const gcalDeleteEventTool = googleTool({
  name: "gcal_delete_event",
  description:
    "Delete a Google Calendar event (attendees are notified). IRREVERSIBLE: needs_confirmation first, then confirmed=true. Spanish: cancelar reunión, borrar evento",
  parameters: {
    type: "object",
    properties: { event_id: { type: "string" }, calendar_id: { type: "string" }, confirmed: CONFIRMED_PARAM },
    required: ["event_id"],
  },
  run: async (p, { userId }) => {
    const id = str(p.event_id);
    if (!id) return { ok: false, error: "event_id es obligatorio." };
    const pending = needsConfirmation(p, { event_id: id, action: "delete" });
    if (pending) return pending;
    await googleJson(userId, "calendar", `${API}/calendars/${cal(p)}/events/${encodeURIComponent(id)}`, {
      method: "DELETE", query: { sendUpdates: "all" },
    });
    return { ok: true, deleted: id };
  },
});

export const gcalFreebusyTool = googleTool({
  name: "gcal_freebusy",
  description:
    "Check busy intervals for one or more calendars in a time range to find free slots. Spanish: disponibilidad, horarios libres, cuándo estoy libre",
  parameters: {
    type: "object",
    properties: {
      time_min: { type: "string", description: ISO },
      time_max: { type: "string", description: ISO },
      calendar_ids: { type: "array", items: { type: "string" }, description: "Default: [primary]. Other people's emails work if they share their calendar." },
    },
    required: ["time_min", "time_max"],
  },
  run: async (p, { userId }) => {
    const timeMin = str(p.time_min), timeMax = str(p.time_max);
    if (!timeMin || !timeMax) return { ok: false, error: "time_min y time_max son obligatorios." };
    const ids = Array.isArray(p.calendar_ids) && p.calendar_ids.length ? (p.calendar_ids as string[]).slice(0, 10) : ["primary"];
    const data = await googleJson<any>(userId, "calendar", `${API}/freeBusy`, {
      method: "POST",
      body: { timeMin, timeMax, items: ids.map((id) => ({ id })) },
    });
    const calendars = Object.fromEntries(Object.entries<any>(data.calendars ?? {}).map(([id, c]) => [id, { busy: c.busy ?? [], errors: c.errors }]));
    return { ok: true, calendars };
  },
});

export const calendarTools = [
  gcalListEventsTool, gcalCreateEventTool, gcalUpdateEventTool, gcalDeleteEventTool, gcalFreebusyTool,
];
