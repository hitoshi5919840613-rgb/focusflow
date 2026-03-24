"use client";

import type {
  Category,
  DecomposeTemplate,
  NotificationSettings,
  Routine
} from "@/lib/client/db";
import { db } from "@/lib/client/db";

const defaultCategories: Category[] = [
  { name: "仕事", color: "#2563EB", icon: "briefcase", sortOrder: 1 },
  { name: "プライベート", color: "#10B981", icon: "home", sortOrder: 2 },
  { name: "Voicy", color: "#F59E0B", icon: "mic", sortOrder: 3 },
  { name: "書籍", color: "#F97316", icon: "book-open", sortOrder: 4 }
];

const defaultTemplates: DecomposeTemplate[] = [
  {
    keyword: "作成",
    steps: [
      "必要な情報を集める",
      "構成・アウトラインを決める",
      "ドラフトを書く",
      "確認・修正する",
      "提出・共有する"
    ]
  },
  {
    keyword: "準備",
    steps: ["必要物を確認する", "段取りを決める", "実行する", "最終チェックをする"]
  },
  {
    keyword: "会議",
    steps: ["資料を確認する", "議題を整理する", "会議に参加する", "議事録をまとめる"]
  },
  {
    keyword: "入力",
    steps: ["必要データを集める", "入力する", "内容を確認する", "提出・送信する"]
  }
];

const defaultRoutines: Routine[] = [
  { name: "起床", durationMinutes: 10, startTime: "04:30", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], sortOrder: 1, isActive: true },
  { name: "Voicy", durationMinutes: 30, startTime: "04:40", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], sortOrder: 2, isActive: true },
  { name: "筋トレ", durationMinutes: 30, startTime: "05:10", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], sortOrder: 3, isActive: true },
  { name: "ランニング", durationMinutes: 30, startTime: "05:40", daysOfWeek: [1, 3, 5, 7], sortOrder: 4, isActive: true },
  { name: "ストレッチ", durationMinutes: 20, startTime: "06:10", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], sortOrder: 5, isActive: true },
  { name: "読書", durationMinutes: 30, startTime: "06:30", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], sortOrder: 6, isActive: true },
  { name: "身支度", durationMinutes: 30, startTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], sortOrder: 7, isActive: true }
];

const defaultNotificationSettings: NotificationSettings = {
  notify1DayBefore: true,
  notify3HoursBefore: true,
  notify1HourBefore: true,
  nudgeIntervalMinutes: 180,
  pomodoroMinutes: 25,
  breakMinutes: 5
};

export async function ensureSeedData() {
  await db.transaction(
    "rw",
    db.categories,
    db.decomposeTemplates,
    db.routines,
    db.notificationSettings,
    async () => {
      if ((await db.categories.count()) === 0) {
        await db.categories.bulkAdd(defaultCategories);
      }

      if ((await db.decomposeTemplates.count()) === 0) {
        await db.decomposeTemplates.bulkAdd(defaultTemplates);
      }

      if ((await db.routines.count()) === 0) {
        await db.routines.bulkAdd(defaultRoutines);
      }

      if ((await db.notificationSettings.count()) === 0) {
        await db.notificationSettings.add(defaultNotificationSettings);
      }
    }
  );
}
