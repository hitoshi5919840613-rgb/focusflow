"use client";

import { db, type Priority, type Task, type TaskStatus } from "@/lib/client/db";
import { ensureSeedData } from "@/lib/client/seed";

export type SubtaskViewItem = Task;

export type TaskViewItem = Task & {
  categoryName: string;
  categoryColor: string;
  urgency: "overdue" | "today" | "focus" | "upcoming";
  subtasks: SubtaskViewItem[];
  progress: {
    done: number;
    total: number;
  };
  nextSubtask?: SubtaskViewItem;
};

export type CreateTaskInput = {
  title: string;
  categoryId?: number;
  dueDate?: Date;
  priority: Priority;
  description?: string;
};

export type UpdateTaskInput = CreateTaskInput & {
  status?: TaskStatus;
};

export async function getTaskComposerData() {
  await db.open();
  await ensureSeedData();

  const categories = await db.categories.orderBy("sortOrder").toArray();

  return { categories };
}

export async function createTask(input: CreateTaskInput) {
  await db.open();
  await ensureSeedData();

  const now = new Date();
  const nextSortOrder = (await db.tasks.orderBy("sortOrder").last())?.sortOrder ?? 0;

  return db.tasks.add({
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    categoryId: input.categoryId,
    dueDate: input.dueDate,
    priority: input.priority,
    status: "todo",
    sortOrder: nextSortOrder + 1,
    createdAt: now,
    updatedAt: now
  });
}

export async function updateTask(taskId: number, input: UpdateTaskInput) {
  await db.open();
  await ensureSeedData();

  const current = await db.tasks.get(taskId);
  if (!current) {
    throw new Error("更新対象のタスクが見つかりません。");
  }

  const nextStatus = input.status ?? current.status;
  const updatedAt = new Date();

  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.update(taskId, {
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      categoryId: input.categoryId,
      dueDate: input.dueDate,
      priority: input.priority,
      status: nextStatus,
      completedAt: nextStatus === "done" ? current.completedAt ?? updatedAt : undefined,
      updatedAt
    });

    if (nextStatus === "done") {
      await markChildTasksDone(taskId, updatedAt);
    }
  });
}

export async function deleteTask(taskId: number) {
  await db.open();
  await ensureSeedData();

  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.where("parentTaskId").equals(taskId).delete();
    await db.tasks.delete(taskId);
  });
}

export async function cycleTaskStatus(taskId: number) {
  await db.open();
  await ensureSeedData();

  const task = await db.tasks.get(taskId);
  if (!task) {
    throw new Error("対象タスクが見つかりません。");
  }

  const nextStatus = getNextStatus(task.status);
  const updatedAt = new Date();

  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.update(taskId, {
      status: nextStatus,
      completedAt: nextStatus === "done" ? updatedAt : undefined,
      updatedAt
    });

    if (nextStatus === "done") {
      await markChildTasksDone(taskId, updatedAt);
    }
  });

  return nextStatus;
}

export async function markTaskDone(taskId: number) {
  await db.open();
  await ensureSeedData();

  const task = await db.tasks.get(taskId);
  if (!task) {
    throw new Error("対象タスクが見つかりません。");
  }

  if (task.status === "done") {
    return "done";
  }

  const updatedAt = new Date();

  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.update(taskId, {
      status: "done",
      completedAt: updatedAt,
      updatedAt
    });

    await markChildTasksDone(taskId, updatedAt);
  });

  return "done";
}

export async function createSubtask(parentTaskId: number, title: string) {
  await db.open();
  await ensureSeedData();

  const parentTask = await db.tasks.get(parentTaskId);
  if (!parentTask) {
    throw new Error("親タスクが見つかりません。");
  }

  const siblings = await db.tasks.where("parentTaskId").equals(parentTaskId).sortBy("sortOrder");
  const nextSortOrder = siblings.at(-1)?.sortOrder ?? 0;
  const now = new Date();

  return db.tasks.add({
    title: title.trim(),
    description: undefined,
    categoryId: parentTask.categoryId,
    dueDate: parentTask.dueDate,
    priority: parentTask.priority,
    status: "todo",
    parentTaskId,
    sortOrder: nextSortOrder + 1,
    createdAt: now,
    updatedAt: now
  });
}

export async function updateSubtask(subtaskId: number, input: { title: string; status?: TaskStatus }) {
  await db.open();
  await ensureSeedData();

  const subtask = await db.tasks.get(subtaskId);
  if (!subtask) {
    throw new Error("サブタスクが見つかりません。");
  }

  const nextStatus = input.status ?? subtask.status;
  await db.tasks.update(subtaskId, {
    title: input.title.trim(),
    status: nextStatus,
    completedAt: nextStatus === "done" ? subtask.completedAt ?? new Date() : undefined,
    updatedAt: new Date()
  });
}

export async function toggleSubtaskStatus(subtaskId: number) {
  await db.open();
  await ensureSeedData();

  const subtask = await db.tasks.get(subtaskId);
  if (!subtask) {
    throw new Error("サブタスクが見つかりません。");
  }

  const nextStatus: TaskStatus = subtask.status === "done" ? "todo" : "done";
  await db.tasks.update(subtaskId, {
    status: nextStatus,
    completedAt: nextStatus === "done" ? new Date() : undefined,
    updatedAt: new Date()
  });

  return nextStatus;
}

export async function deleteSubtask(subtaskId: number) {
  await db.open();
  await ensureSeedData();
  await db.tasks.delete(subtaskId);
}

export async function getAllTasks() {
  await db.open();
  await ensureSeedData();

  const [categories, allTasks] = await Promise.all([db.categories.toArray(), db.tasks.toArray()]);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const subtasksByParent = new Map<number, SubtaskViewItem[]>();
  const start = startOfToday();
  const end = endOfToday();

  allTasks
    .filter((task) => typeof task.parentTaskId === "number")
    .forEach((subtask) => {
      const parentId = subtask.parentTaskId as number;
      const items = subtasksByParent.get(parentId) ?? [];
      items.push(subtask);
      subtasksByParent.set(parentId, items);
    });

  return allTasks
    .filter((task) => !task.parentTaskId)
    .map<TaskViewItem>((task) => {
      const category = task.categoryId ? categoryMap.get(task.categoryId) : undefined;
      const subtasks = [...(subtasksByParent.get(task.id as number) ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      const doneCount = subtasks.filter((subtask) => subtask.status === "done").length;
      const nextSubtask = subtasks.find((subtask) => subtask.status !== "done");

      return {
        ...task,
        categoryName: category?.name ?? "未分類",
        categoryColor: category?.color ?? "#64748B",
        urgency: getUrgency(task, start, end),
        subtasks,
        progress: {
          done: doneCount,
          total: subtasks.length
        },
        nextSubtask
      };
    });
}

async function markChildTasksDone(parentTaskId: number, updatedAt: Date) {
  const children = await db.tasks.where("parentTaskId").equals(parentTaskId).toArray();
  await Promise.all(
    children.map((child) =>
      db.tasks.update(child.id as number, {
        status: "done",
        completedAt: updatedAt,
        updatedAt
      })
    )
  );
}

function getNextStatus(status: TaskStatus): TaskStatus {
  if (status === "todo") {
    return "in_progress";
  }

  if (status === "in_progress") {
    return "done";
  }

  return "todo";
}

function getUrgency(task: Task, start: Date, end: Date): TaskViewItem["urgency"] {
  if (task.dueDate && task.dueDate < start && task.status !== "done") {
    return "overdue";
  }

  if (task.dueDate && task.dueDate >= start && task.dueDate <= end && task.status !== "done") {
    return "today";
  }

  if (task.status === "in_progress") {
    return "focus";
  }

  return "upcoming";
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}
