/**
 * Utility functions for user-specific date and time formatting.
 */

export function getUserDate(timezone: string = "UTC", date: Date = new Date()): string {
    try {
        const formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        const parts = formatter.formatToParts(date);
        const year = parts.find(p => p.type === "year")?.value;
        const month = parts.find(p => p.type === "month")?.value;
        const day = parts.find(p => p.type === "day")?.value;
        return `${year}-${month}-${day}`;
    } catch (e) {
        // Fallback to UTC if timezone is invalid
        return date.toISOString().split("T")[0];
    }
}

export function getUserTime(timezone: string = "UTC", date: Date = new Date()): string {
    try {
        const formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        const parts = formatter.formatToParts(date);
        const hour = parts.find(p => p.type === "hour")?.value;
        const minute = parts.find(p => p.type === "minute")?.value;
        const second = parts.find(p => p.type === "second")?.value;
        return `${hour}:${minute}:${second}`;
    } catch (e) {
        // Fallback if formatting fails
        return date.toISOString().split("T")[1].split(".")[0];
    }
}

/**
 * Fecha y hora legibles en la zona horaria del usuario (p. ej. "17/11/2026 14:30:05").
 * Acepta ISO o Date; devuelve null si no hay valor y cae a UTC si la zona es inválida.
 */
export function formatUserDateTime(
    value: string | Date | null | undefined,
    timezone: string = "UTC",
): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const fmt = (tz: string) => {
        const parts = new Intl.DateTimeFormat("es-CO", {
            timeZone: tz,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
        }).formatToParts(date);
        const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
        const hour = p("hour") === "24" ? "00" : p("hour");
        return `${p("day")}/${p("month")}/${p("year")} ${hour}:${p("minute")}:${p("second")}`;
    };
    try {
        return fmt(timezone);
    } catch {
        return fmt("UTC");
    }
}
