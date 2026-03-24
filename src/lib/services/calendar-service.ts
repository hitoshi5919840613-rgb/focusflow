"use client";

import { type TaskViewItem } from "@/lib/services/task-service";

export type CalendarViewMode = "month" | "week";

export type CalendarDay = {
  key: string;
  date: Date;
  isToday: boolean;
  isCurrentMonth: boolean;
  tasks: TaskViewItem[];
  openCount: number;
  overdueCount: number;
};

export function buildMonthCalendar(anchorDate: Date, tasks: TaskViewItem[]) {
  const monthStart = startOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart);
  const days: CalendarDay[] = [];

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    days.push(buildCalendarDay(date, tasks, monthStart.getMonth()));
  }

  return days;
}

export function buildWeekCalendar(anchorDate: Date, tasks: TaskViewItem[]) {
  const weekStart = startOfWeek(anchorDate);
  return Array.from({ length: 7 }, (_, index) => buildCalendarDay(addDays(weekStart, index), tasks));
}

export function getTasksForCalendarDate(tasks: TaskViewItem[], date: Date) {
  const start = startOfDay(date);
  const end = endOfDay(date);

  return tasks
    .filter((task) => task.dueDate && task.dueDate >= start && task.dueDate <= end)
    .sort((a, b) => {
      return (
        (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
        priorityWeight(a.priority) - priorityWeight(b.priority) ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
      );
    });
}

export function getCalendarRangeLabel(anchorDate: Date, mode: CalendarViewMode) {
  if (mode === "month") {
    return anchorDate.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long"
    });
  }

  const weekDays = buildWeekCalendar(anchorDate, []);
  const first = weekDays[0]?.date ?? anchorDate;
  const last = weekDays[6]?.date ?? anchorDate;

  return `${first.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric"
  })} - ${last.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric"
  })}`;
}

export function shiftCalendarAnchor(anchorDate: Date, mode: CalendarViewMode, direction: -1 | 1) {
  const next = new Date(anchorDate);

  if (mode === "month") {
    next.setMonth(next.getMonth() + direction);
    return startOfMonth(next);
  }

  next.setDate(next.getDate() + direction * 7);
  return startOfDay(next);
}

export function isSameDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function startOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function setDateWithTime(targetDate: Date, sourceDate?: Date) {
  const next = new Date(targetDate);
  if (sourceDate) {
    next.setHours(sourceDate.getHours(), sourceDate.getMinutes(), 0, 0);
    return next;
  }

  next.setHours(9, 0, 0, 0);
  return next;
}

function buildCalendarDay(date: Date, tasks: TaskViewItem[], currentMonth = date.getMonth()): CalendarDay {
  const dayTasks = getTasksForCalendarDate(tasks, date);

  return {
    key: toDateKey(date),
    date,
    isToday: isSameDate(date, new Date()),
    isCurrentMonth: date.getMonth() === currentMonth,
    tasks: dayTasks,
    openCount: dayTasks.filter((task) => task.status !== "done").length,
    overdueCount: dayTasks.filter((task) => task.urgency === "overdue" && task.status !== "done").length
  };
}

function startOfMonth(input: Date) {
  const date = new Date(input);
  date.setDate(1);
  return startOfDay(date);
}

function startOfWeek(input: Date) {
  const date = startOfDay(input);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date;
}

function addDays(input: Date, days: number) {
  const date = new Date(input);
  date.setDate(date.getDate() + days);
  return date;
}

function priorityWeight(priority: TaskViewItem["priority"]) {
  if (priority === "high") {
    return 0;
  }

  if (priority === "medium") {
    return 1;
  }

  return 2;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}
