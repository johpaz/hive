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
