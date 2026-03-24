"use client";

import Dexie, { type Table } from "dexie";

export type Priority = "high" | "medium" | "low";
export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id?: number;
  title: string;
  description?: string;
  categoryId?: number;
  dueDate?: Date;
  priority: Priority;
  estimatedMinutes?: number;
  status: TaskStatus;
  parentTaskId?: number;
  sortOrder: number;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id?: number;
  name: string;
  color: string;
  icon?: string;
  sortOrder: number;
}

export interface VoiceMemo {
  id?: number;
  transcript: string;
  keywords?: string[];
  memoType: "memo" | "morning_page" | "task_candidate";
  linkedTaskId?: number;
  recordedAt: Date;
  createdAt: Date;
}

export interface Routine {
  id?: number;
  name: string;
  durationMinutes: number;
  startTime?: string;
  daysOfWeek: number[];
  sortOrder: number;
  isActive: boolean;
}

export interface RoutineLog {
  id?: number;
  routineId: number;
  completedDate: string;
  completedAt: Date;
  skipped: boolean;
  note?: string;
}

export interface NotificationSettings {
  id?: number;
  notify1DayBefore: boolean;
  notify3HoursBefore: boolean;
  notify1HourBefore: boolean;
  nudgeIntervalMinutes: number;
  pomodoroMinutes: number;
  breakMinutes: number;
}

export interface ReadingLog {
  id?: number;
  title: string;
  author?: string;
  isbn?: string;
  finishedDate?: string;
  rating?: number;
  note?: string;
  source: "manual" | "kindle" | "bookmeter" | "bukurog";
  createdAt: Date;
}

export interface DecomposeTemplate {
  id?: number;
  keyword: string;
  steps: string[];
}

export class FocusFlowDB extends Dexie {
  tasks!: Table<Task>;
  categories!: Table<Category>;
  voiceMemos!: Table<VoiceMemo>;
  routines!: Table<Routine>;
  routineLogs!: Table<RoutineLog>;
  notificationSettings!: Table<NotificationSettings>;
  readingLogs!: Table<ReadingLog>;
  decomposeTemplates!: Table<DecomposeTemplate>;

  constructor() {
    super("FocusFlowDB");

    this.version(1).stores({
      tasks: "++id, categoryId, dueDate, priority, status, parentTaskId, sortOrder, createdAt, updatedAt",
      categories: "++id, name, sortOrder",
      voiceMemos: "++id, memoType, recordedAt, createdAt",
      routines: "++id, sortOrder, isActive",
      routineLogs: "++id, routineId, completedDate",
      notificationSettings: "++id",
      readingLogs: "++id, finishedDate, createdAt",
      decomposeTemplates: "++id, keyword"
    });
  }
}

export const db = new FocusFlowDB();
