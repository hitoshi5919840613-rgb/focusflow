"use client";

import { db, type NotificationSettings } from "@/lib/client/db";
import { ensureSeedData } from "@/lib/client/seed";
import { type TaskViewItem } from "@/lib/services/task-service";

const NOTIFICATION_LOG_KEY = "focusflow-notification-log";

type ReminderPreset = {
  kind: DeadlineNotificationKind;
  enabled: boolean;
  offsetMs: number;
};

export type NotificationPermissionState = NotificationPermission | "unsupported";

export type DeadlineNotificationKind =
  | "day_before"
  | "three_hours"
  | "one_hour"
  | "overdue"
  | "nudge"
  | "pomodoro_focus_end"
  | "pomodoro_break_end";

export type ScheduledNotificationItem = {
  id: string;
  kind: DeadlineNotificationKind;
  title: string;
  body: string;
  scheduledFor: Date;
  taskId?: number;
  taskTitle?: string;
  tone?: "morning" | "daytime" | "evening" | "late";
  tag: string;
};

type StoredNotificationLog = Record<string, string>;

export async function getNotificationSettings(): Promise<NotificationSettings> {
  await db.open();
  await ensureSeedData();

  const settings = await db.notificationSettings.toCollection().first();
  if (!settings) {
    throw new Error("通知設定の読み込みに失敗しました。");
  }

  return settings;
}

export async function updateNotificationSettings(
  input: Partial<Omit<NotificationSettings, "id">>
): Promise<NotificationSettings> {
  await db.open();
  await ensureSeedData();

  const current = await db.notificationSettings.toCollection().first();
  if (!current?.id) {
    throw new Error("更新対象の通知設定が見つかりません。");
  }

  await db.notificationSettings.update(current.id, input);

  const updated = await db.notificationSettings.get(current.id);
  if (!updated) {
    throw new Error("通知設定の更新に失敗しました。");
  }

  return updated;
}

export function supportsNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermissionState(): NotificationPermissionState {
  if (!supportsNotifications()) {
    return "unsupported";
  }

  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!supportsNotifications()) {
    return "unsupported";
  }

  return Notification.requestPermission();
}

export function getUpcomingDeadlineNotifications(
  tasks: TaskViewItem[],
  settings: NotificationSettings,
  now = new Date()
) {
  return buildDeadlineNotifications(tasks, settings)
    .filter((item) => item.scheduledFor.getTime() > now.getTime())
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

export async function syncImmediateNotifications(
  tasks: TaskViewItem[],
  settings: NotificationSettings,
  now = new Date()
) {
  const reminders = buildDeadlineNotifications(tasks, settings);
  const pendingDeliveries = reminders.filter((item) => {
    if (item.scheduledFor.getTime() > now.getTime()) {
      return false;
    }

    return now.getTime() - item.scheduledFor.getTime() <= getGraceMsForReminder(item.kind);
  });

  for (const reminder of pendingDeliveries) {
    if (hasNotificationBeenSent(reminder.id)) {
      continue;
    }

    await showNotification(reminder);
  }

  const overdueNotifications = buildOverdueNotifications(tasks, now);

  for (const item of overdueNotifications) {
    if (hasNotificationBeenSent(item.id)) {
      continue;
    }

    await showNotification(item);
  }

  return getUpcomingDeadlineNotifications(tasks, settings, now);
}

export function scheduleDeadlineNotifications(
  tasks: TaskViewItem[],
  settings: NotificationSettings,
  now = new Date()
) {
  const upcoming = getUpcomingDeadlineNotifications(tasks, settings, now);
  const timeouts = upcoming.map((item) =>
    window.setTimeout(() => {
      void showNotification(item);
    }, item.scheduledFor.getTime() - now.getTime())
  );

  return {
    upcoming,
    cancel() {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    }
  };
}

export function buildNudgeNotification(
  tasks: TaskViewItem[],
  settings: NotificationSettings,
  now = new Date()
): ScheduledNotificationItem | null {
  const candidate = pickNudgeTask(tasks);
  if (!candidate?.id) {
    return null;
  }

  const tone = getNudgeTone(now);
  const intervalBucket = Math.floor(
    now.getTime() / (Math.max(30, settings.nudgeIntervalMinutes) * 60_000)
  );

  return {
    id: `nudge:${candidate.id}:${intervalBucket}`,
    kind: "nudge",
    title: tone.title,
    body: buildNudgeBody(candidate, tone.bodyLead),
    scheduledFor: now,
    taskId: candidate.id,
    taskTitle: candidate.title,
    tone: tone.key,
    tag: `focusflow-nudge-${candidate.id}`
  };
}

export async function sendNudgeNotification(
  tasks: TaskViewItem[],
  settings: NotificationSettings,
  now = new Date()
) {
  const notification = buildNudgeNotification(tasks, settings, now);
  if (!notification || hasNotificationBeenSent(notification.id)) {
    return false;
  }

  await showNotification(notification);
  return true;
}

export async function showPomodoroTransitionNotification(input: {
  type: "focus_end" | "break_end";
  taskTitle?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const timestamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}`;
  const title = input.type === "focus_end" ? "集中時間が終わりました" : "休憩が終わりました";
  const body =
    input.type === "focus_end"
      ? input.taskTitle
        ? `「${input.taskTitle}」をここでひと区切り。少し体をゆるめましょう。`
        : "ここで少し休憩を入れましょう。"
      : input.taskTitle
        ? `「${input.taskTitle}」に戻るなら、最初の 1 分だけでも十分です。`
        : "次の 1 セッションを始めるなら、軽く再開してみましょう。";

  return showNotification({
    id: `pomodoro:${input.type}:${timestamp}`,
    kind: input.type === "focus_end" ? "pomodoro_focus_end" : "pomodoro_break_end",
    title,
    body,
    scheduledFor: now,
    taskTitle: input.taskTitle,
    tag: `focusflow-pomodoro-${input.type}`
  });
}

export function getNudgeTone(now = new Date()) {
  const hour = now.getHours();

  if (hour >= 4 && hour < 10) {
    return {
      key: "morning" as const,
      title: "朝の勢いを味方にしましょう",
      bodyLead: "朝の最初のひと押しとして"
    };
  }

  if (hour >= 10 && hour < 18) {
    return {
      key: "daytime" as const,
      title: "そろそろひとつ前に進めませんか",
      bodyLead: "流れを切り替えるなら"
    };
  }

  if (hour >= 18 && hour < 23) {
    return {
      key: "evening" as const,
      title: "夜はやさしく整えましょう",
      bodyLead: "今日は無理しすぎず"
    };
  }

  return {
    key: "late" as const,
    title: "今は負担を増やしすぎなくて大丈夫です",
    bodyLead: "深い時間なので"
  };
}

export function formatScheduledTime(date: Date) {
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function showNotification(item: ScheduledNotificationItem) {
  if (!supportsNotifications() || Notification.permission !== "granted") {
    return false;
  }

  const registration = await getServiceWorkerRegistration();
  const options: NotificationOptions = {
    body: item.body,
    tag: item.tag,
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    data: {
      url: "/",
      taskId: item.taskId,
      taskTitle: item.taskTitle,
      notificationId: item.id
    }
  };

  if (registration) {
    await registration.showNotification(item.title, options);
  } else {
    new Notification(item.title, options);
  }

  markNotificationSent(item.id);
  return true;
}

async function getServiceWorkerRegistration() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function buildDeadlineNotifications(tasks: TaskViewItem[], settings: NotificationSettings) {
  const openTasks = tasks.filter((task) => task.status !== "done" && task.dueDate);
  const reminders: ScheduledNotificationItem[] = [];

  for (const task of openTasks) {
    const dueDate = task.dueDate as Date;
    const presets: ReminderPreset[] = [
      {
        kind: "day_before",
        enabled: settings.notify1DayBefore,
        offsetMs: 24 * 60 * 60 * 1000
      },
      {
        kind: "three_hours",
        enabled: settings.notify3HoursBefore,
        offsetMs: 3 * 60 * 60 * 1000
      },
      {
        kind: "one_hour",
        enabled: settings.notify1HourBefore,
        offsetMs: 60 * 60 * 1000
      }
    ];

    for (const preset of presets) {
      if (!preset.enabled || !task.id) {
        continue;
      }

      const scheduledFor = new Date(dueDate.getTime() - preset.offsetMs);
      reminders.push({
        id: `deadline:${task.id}:${preset.kind}:${scheduledFor.toISOString()}`,
        kind: preset.kind,
        title: buildReminderTitle(task.title, preset.kind),
        body: buildReminderBody(task, dueDate, preset.kind),
        scheduledFor,
        taskId: task.id,
        taskTitle: task.title,
        tag: `focusflow-deadline-${task.id}-${preset.kind}`
      });
    }
  }

  return reminders.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

function buildOverdueNotifications(tasks: TaskViewItem[], now: Date) {
  return tasks
    .filter((task) => task.id && task.status !== "done" && task.urgency === "overdue")
    .map<ScheduledNotificationItem>((task) => ({
      id: `overdue:${task.id}:${toDateKey(now)}`,
      kind: "overdue",
      title: `「${task.title}」は期限を過ぎています`,
      body: task.nextSubtask
        ? `まずは「${task.nextSubtask.title}」だけ進める形で立て直していきましょう。`
        : "責めなくて大丈夫です。最初の 5 分だけ触れてみるところから戻れます。",
      scheduledFor: now,
      taskId: task.id,
      taskTitle: task.title,
      tag: `focusflow-overdue-${task.id}`
    }));
}

function pickNudgeTask(tasks: TaskViewItem[]) {
  const candidates = tasks.filter((task) => task.status !== "done");
  if (candidates.length === 0) {
    return null;
  }

  const priorityScore = { high: 0, medium: 1, low: 2 };
  const urgencyScore = { overdue: 0, today: 1, focus: 2, upcoming: 3 };

  return [...candidates].sort((a, b) => {
    return (
      urgencyScore[a.urgency] - urgencyScore[b.urgency] ||
      priorityScore[a.priority] - priorityScore[b.priority] ||
      (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  })[0];
}

function buildNudgeBody(task: TaskViewItem, lead: string) {
  const target = task.nextSubtask?.title ?? task.title;

  if (task.urgency === "overdue") {
    return `${lead}、期限を過ぎた「${task.title}」の立て直しを 5 分だけ始めませんか。`;
  }

  if (task.urgency === "today") {
    return `${lead}、今日が期限の「${task.title}」を先に軽く進めておくと安心です。`;
  }

  if (task.status === "in_progress") {
    return `${lead}、続きの「${target}」に戻ると流れがつながりやすいです。`;
  }

  return `${lead}、「${target}」から小さく始めてみましょう。`;
}

function buildReminderTitle(taskTitle: string, kind: DeadlineNotificationKind) {
  if (kind === "day_before") {
    return `明日は「${taskTitle}」の期限です`;
  }

  if (kind === "three_hours") {
    return `あと 3 時間で「${taskTitle}」が期限です`;
  }

  return `あと 1 時間で「${taskTitle}」が期限です`;
}

function buildReminderBody(task: TaskViewItem, dueDate: Date, kind: DeadlineNotificationKind) {
  const dueLabel = formatScheduledTime(dueDate);
  const nextStep = task.nextSubtask?.title;

  if (kind === "day_before") {
    return nextStep
      ? `期限は ${dueLabel} です。まずは「${nextStep}」だけでも先に進めておきましょう。`
      : `期限は ${dueLabel} です。余裕のあるうちに最初の 1 歩だけ触れておくのがおすすめです。`;
  }

  if (kind === "three_hours") {
    return nextStep
      ? `期限は ${dueLabel}。ここからは「${nextStep}」を優先すると間に合いやすいです。`
      : `期限は ${dueLabel}。ここで 1 回だけ集中時間を取ると流れを戻しやすいです。`;
  }

  return nextStep
    ? `期限は ${dueLabel} です。今は「${nextStep}」に絞って進めましょう。`
    : `期限は ${dueLabel} です。完璧でなくていいので、出せる形まで一気に近づけましょう。`;
}

function getGraceMsForReminder(kind: DeadlineNotificationKind) {
  if (kind === "day_before") {
    return 10 * 60 * 60 * 1000;
  }

  if (kind === "three_hours") {
    return 75 * 60 * 1000;
  }

  if (kind === "one_hour") {
    return 35 * 60 * 1000;
  }

  return 0;
}

function hasNotificationBeenSent(id: string) {
  const log = readNotificationLog();
  return typeof log[id] === "string";
}

function markNotificationSent(id: string) {
  const log = readNotificationLog();
  log[id] = new Date().toISOString();

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const trimmed = Object.fromEntries(
    Object.entries(log).filter(([, timestamp]) => {
      const value = new Date(timestamp).getTime();
      return Number.isFinite(value) && value >= cutoff;
    })
  );

  writeNotificationLog(trimmed);
}

function readNotificationLog(): StoredNotificationLog {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(NOTIFICATION_LOG_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as StoredNotificationLog) : {};
  } catch {
    return {};
  }
}

function writeNotificationLog(log: StoredNotificationLog) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(NOTIFICATION_LOG_KEY, JSON.stringify(log));
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}
