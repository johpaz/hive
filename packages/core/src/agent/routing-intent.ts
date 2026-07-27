function normalizeIntent(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Calendar operations are external data mutations/lookups, not future Hive
 * executions. Keep them out of the native cron tool and skill selectors so
 * the coordinator can discover the configured calendar MCP server instead.
 */
export function isCalendarOperation(value: string): boolean {
  const text = normalizeIntent(value);
  const namesCalendar = /\b(calendario|calendar|agenda)\b/.test(text);
  const calendarAction = /\b(crear?|agend\w*|anad\w*|agreg\w*|consult\w*|list\w*|modific\w*|mov\w*|cancel\w*|elimin\w*|invit\w*|reserv\w*|disponibilidad|availability)\b/.test(text);
  if (namesCalendar && calendarAction) return true;

  const directlySchedulesMeeting = /\b(crea(?:r)?|agenda(?:r)?|programa(?:r)?|reserva(?:r)?)\s+(?:un|una|la|el|nueva|nuevo)?\s*(reunion|cita|meeting)\b/.test(text);
  const managesAttendees = /\b(invit\w*|asistente\w*|attendee\w*)\b.*\b(reunion|cita|meeting)\b|\b(reunion|cita|meeting)\b.*\b(invit\w*|asistente\w*|attendee\w*)\b/.test(text);
  return directlySchedulesMeeting || managesAttendees;
}
