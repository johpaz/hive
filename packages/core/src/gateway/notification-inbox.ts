import { randomUUID } from "node:crypto";
import type { NotificationDoc } from "../storage/collections";
import { col, updateDoc } from "../storage/hive";

export async function createNotification(input: {
  userId: string;
  channel: string;
  message: string;
}): Promise<NotificationDoc> {
  const notifications = await col<NotificationDoc>("notifications");
  const id = randomUUID();
  const notification: NotificationDoc = {
    id,
    user_id: input.userId,
    channel: input.channel,
    message: input.message,
    created_at: Date.now(),
    delivered_at: null,
    read_at: null,
  };
  await notifications.put(id, notification, { expectedVersion: 0 });
  return notification;
}

export async function listPendingNotifications(
  userId: string,
  channel: string,
): Promise<NotificationDoc[]> {
  const notifications = await col<NotificationDoc>("notifications");
  const rows = await notifications.findBy("user_id", userId);
  return rows
    .map((row) => row.doc)
    .filter((notification) => notification.channel === channel && notification.read_at === null)
    .sort((a, b) => a.created_at - b.created_at);
}

export async function markNotificationDelivered(id: string, userId: string): Promise<boolean> {
  const notifications = await col<NotificationDoc>("notifications");
  const existing = await notifications.get(id);
  if (!existing || existing.doc.user_id !== userId) return false;
  if (existing.doc.delivered_at !== null) return true;
  await updateDoc<NotificationDoc>("notifications", id, { delivered_at: Date.now() });
  return true;
}

export async function acknowledgeNotification(id: string, userId: string): Promise<boolean> {
  const notifications = await col<NotificationDoc>("notifications");
  const existing = await notifications.get(id);
  if (!existing || existing.doc.user_id !== userId) return false;
  if (existing.doc.read_at !== null) return true;
  const now = Date.now();
  await updateDoc<NotificationDoc>("notifications", id, {
    delivered_at: existing.doc.delivered_at ?? now,
    read_at: now,
  });
  return true;
}
