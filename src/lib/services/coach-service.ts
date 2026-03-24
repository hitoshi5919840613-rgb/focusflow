"use client";

import { type TaskViewItem } from "@/lib/services/task-service";

export type DailyCoachSuggestion = {
  headline: string;
  body: string;
  taskId?: number;
  taskTitle?: string;
  stepTitle?: string;
  carryOverTitle?: string;
};

export function generateDailyCoachSuggestion(tasks: TaskViewItem[]): DailyCoachSuggestion {
  const openTasks = tasks.filter((task) => task.status !== "done");
  if (openTasks.length === 0) {
    return {
      headline: "今日は白紙から始められます",
      body: "未完了タスクはありません。必要なら小さな 1 件だけ追加して、軽くスタートしましょう。"
    };
  }

  const overdueTask = pickTopTask(openTasks.filter((task) => task.urgency === "overdue"));
  if (overdueTask) {
    return buildSuggestion(
      overdueTask,
      `期限超過の「${overdueTask.title}」があります。`,
      "まずはここを片づけると、今日の見通しがかなり良くなります。"
    );
  }

  const dueTodayTask = pickTopTask(openTasks.filter((task) => task.urgency === "today"));
  if (dueTodayTask) {
    return buildSuggestion(
      dueTodayTask,
      `今日は「${dueTodayTask.title}」の期限です。`,
      "最初の一歩だけでも先に進めておくと安心です。"
    );
  }

  const carryOverTask = pickCarryOverTask(openTasks);
  if (carryOverTask) {
    const nextStep = carryOverTask.nextSubtask?.title;
    return {
      headline: `昨日の続きは「${carryOverTask.title}」です`,
      body: nextStep
        ? `前日の未完了タスクです。続きの「${nextStep}」から始めると流れに戻りやすいです。`
        : "前日の未完了タスクです。今日はこの続きを最初の 1 件にしてみましょう。",
      taskId: carryOverTask.id,
      taskTitle: carryOverTask.title,
      stepTitle: nextStep,
      carryOverTitle: carryOverTask.title
    };
  }

  const progressTask = pickTopTask(openTasks.filter((task) => task.progress.total > 0 && task.progress.done > 0));
  if (progressTask) {
    return buildSuggestion(
      progressTask,
      `「${progressTask.title}」は ${progressTask.progress.done}/${progressTask.progress.total} ステップ進んでいます。`,
      "途中まで進んでいるものから再開すると勢いが出やすいです。"
    );
  }

  return buildSuggestion(
    pickTopTask(openTasks) ?? openTasks[0],
    "まずは一番インパクトの大きいタスクから始めましょう。",
    "完璧でなくて大丈夫なので、最初の 1 ステップだけ進めれば十分です。"
  );
}

function buildSuggestion(task: TaskViewItem, lead: string, tail: string): DailyCoachSuggestion {
  const nextStep = task.nextSubtask?.title;

  return {
    headline: lead,
    body: nextStep ? `${tail} まずは「${nextStep}」からどうでしょう。` : `${tail} まずは「${task.title}」に触れてみましょう。`,
    taskId: task.id,
    taskTitle: task.title,
    stepTitle: nextStep
  };
}

function pickTopTask(tasks: TaskViewItem[]) {
  const priorityScore = { high: 0, medium: 1, low: 2 };

  return [...tasks].sort((a, b) => {
    return (
      priorityScore[a.priority] - priorityScore[b.priority] ||
      (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  })[0];
}

function pickCarryOverTask(tasks: TaskViewItem[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const candidates = tasks.filter((task) => task.updatedAt < startOfToday || task.createdAt < startOfToday);
  return pickTopTask(candidates);
}
