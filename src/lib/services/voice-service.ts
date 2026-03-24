"use client";

import { db, type Category, type Priority, type VoiceMemo } from "@/lib/client/db";
import { ensureSeedData } from "@/lib/client/seed";
import {
  createTask,
  getAllTasks,
  getTaskComposerData,
  markTaskDone,
  type TaskViewItem
} from "@/lib/services/task-service";

export type VoiceCaptureMode = "auto" | "task" | "memo";

export type VoiceCommandOutcome =
  | {
      kind: "created_task";
      message: string;
      transcript: string;
      taskId: number;
      memoId?: number;
      taskDraft: VoiceTaskDraft;
    }
  | {
      kind: "completed_task";
      message: string;
      transcript: string;
      taskId: number;
      taskTitle: string;
    }
  | {
      kind: "query_today";
      message: string;
      transcript: string;
      tasks: TaskViewItem[];
    }
  | {
      kind: "saved_memo";
      message: string;
      transcript: string;
      memoId: number;
      memoType: VoiceMemo["memoType"];
      suggestedTaskDraft?: VoiceTaskDraft;
    }
  | {
      kind: "error";
      message: string;
      transcript: string;
    };

export type VoiceMemoItem = VoiceMemo & {
  linkedTaskTitle?: string;
};

type ParsedVoiceCommand = {
  action: "create_task" | "complete_task" | "query_today" | "save_memo";
  confidence: "strong_task" | "candidate" | "memo";
  taskDraft?: VoiceTaskDraft;
  targetTaskName?: string;
  memoType: VoiceMemo["memoType"];
  keywords: string[];
};

export type VoiceTaskDraft = {
  title: string;
  categoryId?: number;
  categoryName?: string;
  dueDate?: Date;
  priority: Priority;
  description?: string;
};

const completionPattern = /(完了|終わった|おわった|できた|済み|終えた)/;
const queryPattern = /(今日のタスク|今日やること|何をやる|予定は|タスクを教えて|今日の予定)/;
const strongTaskPattern =
  /(作成|つくる|作る|書く|準備|提出|入力|確認|会議|部会|連絡|予約|申請|送る|返信|仕上げる|まとめる|終わらせる|やる|する)/;
const candidateTaskPattern =
  /(しなきゃ|やらないと|必要|いるな|いる|準備|忘れず|忘れない|〜しよう|しよう|やっておく|やっとく|やっとかな|やること)/;
const categoryAliases: Record<string, string[]> = {
  仕事: ["仕事", "学校", "校務", "授業"],
  プライベート: ["プライベート", "私用", "家", "家庭"],
  Voicy: ["Voicy", "ボイシー", "音声配信"],
  書籍: ["書籍", "本", "原稿", "執筆"]
};

export async function handleVoiceTranscript(
  transcript: string,
  mode: VoiceCaptureMode
): Promise<VoiceCommandOutcome> {
  const normalizedTranscript = normalizeTranscript(transcript);

  if (!normalizedTranscript) {
    return {
      kind: "error",
      message: "音声がうまく取れませんでした。もう一度試してみてください。",
      transcript
    };
  }

  const [{ categories }, tasks] = await Promise.all([getTaskComposerData(), getAllTasks()]);
  const parsed = parseVoiceCommand(normalizedTranscript, categories, new Date());

  if (parsed.action === "query_today") {
    const todayTasks = getVoiceTodayTasks(tasks);
    return {
      kind: "query_today",
      message:
        todayTasks.length > 0
          ? `今日フォーカスするタスクは ${todayTasks.length} 件あります。`
          : "今日フォーカスするタスクはまだありません。",
      transcript: normalizedTranscript,
      tasks: todayTasks
    };
  }

  if (parsed.action === "complete_task" && parsed.targetTaskName) {
    const matchedTask = findTaskByVoiceName(tasks, parsed.targetTaskName);

    if (!matchedTask?.id) {
      const memoId = await saveVoiceMemoRecord({
        transcript: normalizedTranscript,
        memoType: "task_candidate",
        keywords: parsed.keywords
      });

      return {
        kind: "saved_memo",
        message: "完了対象のタスクが見つからなかったので、候補メモとして保存しました。",
        transcript: normalizedTranscript,
        memoId,
        memoType: "task_candidate",
        suggestedTaskDraft: parsed.taskDraft
      };
    }

    await markTaskDone(matchedTask.id);

    return {
      kind: "completed_task",
      message: `「${matchedTask.title}」を完了にしました。`,
      transcript: normalizedTranscript,
      taskId: matchedTask.id,
      taskTitle: matchedTask.title
    };
  }

  if (mode === "memo") {
    const memoId = await saveVoiceMemoRecord({
      transcript: normalizedTranscript,
      memoType: parsed.memoType,
      keywords: parsed.keywords
    });

    return {
      kind: "saved_memo",
      message:
        parsed.memoType === "task_candidate"
          ? "ボイスメモを保存しました。あとでタスク化できます。"
          : parsed.memoType === "morning_page"
            ? "モーニングページとして保存しました。"
            : "ボイスメモを保存しました。",
      transcript: normalizedTranscript,
      memoId,
      memoType: parsed.memoType,
      suggestedTaskDraft: parsed.memoType === "task_candidate" ? parsed.taskDraft : undefined
    };
  }

  if (parsed.action === "create_task" && parsed.taskDraft) {
    if (mode === "auto" && parsed.confidence === "candidate") {
      const memoId = await saveVoiceMemoRecord({
        transcript: normalizedTranscript,
        memoType: "task_candidate",
        keywords: parsed.keywords
      });

      return {
        kind: "saved_memo",
        message: "タスク候補としてボイスメモに保存しました。必要ならそのままタスク化できます。",
        transcript: normalizedTranscript,
        memoId,
        memoType: "task_candidate",
        suggestedTaskDraft: parsed.taskDraft
      };
    }

    const taskId = await createTask({
      title: parsed.taskDraft.title,
      categoryId: parsed.taskDraft.categoryId,
      dueDate: parsed.taskDraft.dueDate,
      priority: parsed.taskDraft.priority,
      description: parsed.taskDraft.description
    });

    return {
      kind: "created_task",
      message: `「${parsed.taskDraft.title}」をタスクに追加しました。`,
      transcript: normalizedTranscript,
      taskId,
      taskDraft: parsed.taskDraft
    };
  }

  const memoId = await saveVoiceMemoRecord({
    transcript: normalizedTranscript,
    memoType: parsed.memoType,
    keywords: parsed.keywords
  });

  return {
    kind: "saved_memo",
    message:
      parsed.memoType === "morning_page"
        ? "モーニングページとして保存しました。"
        : "音声をメモとして保存しました。",
    transcript: normalizedTranscript,
    memoId,
    memoType: parsed.memoType,
    suggestedTaskDraft: parsed.memoType === "task_candidate" ? parsed.taskDraft : undefined
  };
}

export async function getRecentVoiceMemos(limit = 5): Promise<VoiceMemoItem[]> {
  await db.open();
  await ensureSeedData();

  const [memos, tasks] = await Promise.all([
    db.voiceMemos.orderBy("recordedAt").reverse().limit(limit).toArray(),
    db.tasks.toArray()
  ]);
  const taskMap = new Map(tasks.map((task) => [task.id, task.title]));

  return memos.map((memo) => ({
    ...memo,
    linkedTaskTitle: memo.linkedTaskId ? taskMap.get(memo.linkedTaskId) : undefined
  }));
}

export async function convertVoiceMemoToTask(memoId: number) {
  await db.open();
  await ensureSeedData();

  const [memo, { categories }] = await Promise.all([db.voiceMemos.get(memoId), getTaskComposerData()]);

  if (!memo) {
    throw new Error("変換対象のボイスメモが見つかりません。");
  }

  const parsed = parseVoiceCommand(memo.transcript, categories, memo.recordedAt ?? new Date());
  const draft = parsed.taskDraft ?? {
    title: memo.transcript,
    priority: "medium" as Priority
  };

  const taskId = await createTask({
    title: draft.title,
    categoryId: draft.categoryId,
    dueDate: draft.dueDate,
    priority: draft.priority,
    description: draft.description ?? `ボイスメモから変換: ${memo.transcript}`
  });

  await db.voiceMemos.update(memoId, {
    linkedTaskId: taskId,
    memoType: "task_candidate"
  });

  return {
    taskId,
    taskTitle: draft.title
  };
}

export function supportsSpeechRecognition() {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isMorningPageTime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 4 && hour < 9;
}

function parseVoiceCommand(
  transcript: string,
  categories: Category[],
  currentDate: Date
): ParsedVoiceCommand {
  const memoType = detectMemoType(transcript, currentDate);
  const keywords = extractKeywords(transcript, categories);

  if (queryPattern.test(transcript)) {
    return {
      action: "query_today",
      confidence: "memo",
      memoType,
      keywords
    };
  }

  if (completionPattern.test(transcript)) {
    return {
      action: "complete_task",
      confidence: "strong_task",
      targetTaskName: extractCompletionTarget(transcript),
      memoType: "task_candidate",
      keywords
    };
  }

  const categoryMatch = detectCategory(transcript, categories);
  const priority = detectPriority(transcript);
  const dueDate = detectDueDate(transcript, currentDate);
  const title = extractTaskTitle(transcript, categories);
  const hasStrongTaskSignal = strongTaskPattern.test(transcript) || dueDate !== undefined || categoryMatch !== undefined;
  const hasCandidateSignal = candidateTaskPattern.test(transcript);

  if (title && (hasStrongTaskSignal || hasCandidateSignal)) {
    return {
      action: "create_task",
      confidence: hasStrongTaskSignal ? "strong_task" : "candidate",
      memoType: hasStrongTaskSignal ? "task_candidate" : memoType,
      keywords,
      taskDraft: {
        title,
        categoryId: categoryMatch?.id,
        categoryName: categoryMatch?.name,
        dueDate,
        priority,
        description: dueDate ? `音声入力で期限を設定しました: ${formatDateLabel(dueDate)}` : undefined
      }
    };
  }

  return {
    action: "save_memo",
    confidence: memoType === "task_candidate" ? "candidate" : "memo",
    memoType,
    keywords,
    taskDraft:
      memoType === "task_candidate"
        ? {
            title: title || transcript,
            categoryId: categoryMatch?.id,
            categoryName: categoryMatch?.name,
            dueDate,
            priority
          }
        : undefined
  };
}

async function saveVoiceMemoRecord(input: {
  transcript: string;
  memoType: VoiceMemo["memoType"];
  keywords: string[];
}) {
  await db.open();
  await ensureSeedData();

  return db.voiceMemos.add({
    transcript: input.transcript,
    keywords: input.keywords,
    memoType: input.memoType,
    recordedAt: new Date(),
    createdAt: new Date()
  });
}

function getVoiceTodayTasks(tasks: TaskViewItem[]) {
  return tasks
    .filter((task) => task.status !== "done" && task.urgency !== "upcoming")
    .sort((a, b) => {
      const urgencyScore = { overdue: 0, today: 1, focus: 2, upcoming: 3 };
      const priorityScore = { high: 0, medium: 1, low: 2 };

      return (
        urgencyScore[a.urgency] - urgencyScore[b.urgency] ||
        priorityScore[a.priority] - priorityScore[b.priority] ||
        (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER)
      );
    });
}

function findTaskByVoiceName(tasks: TaskViewItem[], target: string) {
  const normalizedTarget = normalizeForMatch(target);
  const openTasks = tasks.filter((task) => task.status !== "done");

  return (
    openTasks.find((task) => normalizeForMatch(task.title) === normalizedTarget) ??
    openTasks.find((task) => normalizeForMatch(task.title).includes(normalizedTarget)) ??
    openTasks.find((task) => normalizedTarget.includes(normalizeForMatch(task.title)))
  );
}

function detectCategory(transcript: string, categories: Category[]) {
  const matchedCustomCategory = categories.find((category) => transcript.includes(category.name));
  if (matchedCustomCategory) {
    return matchedCustomCategory;
  }

  for (const category of categories) {
    const aliases = categoryAliases[category.name] ?? [];
    if (aliases.some((alias) => transcript.includes(alias))) {
      return category;
    }
  }

  return undefined;
}

function detectPriority(transcript: string): Priority {
  if (/(優先度高|急ぎ|大事|重要|最優先)/.test(transcript)) {
    return "high";
  }

  if (/(優先度低|いつでも|ゆっくり|後で)/.test(transcript)) {
    return "low";
  }

  return "medium";
}

function detectDueDate(transcript: string, currentDate: Date) {
  const baseDate = new Date(currentDate);

  if (/今日/.test(transcript)) {
    return withDetectedTime(baseDate, transcript, 18, 0);
  }

  if (/明日/.test(transcript)) {
    const tomorrow = new Date(baseDate);
    tomorrow.setDate(baseDate.getDate() + 1);
    return withDetectedTime(tomorrow, transcript, 18, 0);
  }

  if (/今週中/.test(transcript)) {
    const endOfWeek = new Date(baseDate);
    const distance = (7 - endOfWeek.getDay()) % 7;
    endOfWeek.setDate(baseDate.getDate() + distance);
    return withDetectedTime(endOfWeek, transcript, 18, 0);
  }

  const monthDayMatch = transcript.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDayMatch) {
    const [, month, day] = monthDayMatch;
    const detected = new Date(baseDate.getFullYear(), Number(month) - 1, Number(day));
    if (detected < startOfDay(baseDate)) {
      detected.setFullYear(detected.getFullYear() + 1);
    }
    return withDetectedTime(detected, transcript, 18, 0);
  }

  const weekdayMatch = transcript.match(/(月|火|水|木|金|土|日)曜(?:日)?まで?/);
  if (weekdayMatch) {
    const targetDay = mapWeekdayToNumber(weekdayMatch[1]);
    const detected = nextWeekday(baseDate, targetDay);
    return withDetectedTime(detected, transcript, 18, 0);
  }

  return undefined;
}

function detectMemoType(transcript: string, currentDate: Date): VoiceMemo["memoType"] {
  const hasTaskSignal = candidateTaskPattern.test(transcript) || strongTaskPattern.test(transcript);

  if (isMorningPageTime(currentDate) && !hasTaskSignal) {
    return "morning_page";
  }

  if (hasTaskSignal) {
    return "task_candidate";
  }

  return "memo";
}

function extractTaskTitle(transcript: string, categories: Category[]) {
  const categoryRegex = new RegExp(
    [
      ...categories.flatMap((category) => [escapeRegExp(category.name), ...(categoryAliases[category.name] ?? []).map(escapeRegExp)]),
      "優先度高",
      "優先度低",
      "急ぎ",
      "大事",
      "重要",
      "最優先",
      "いつでも",
      "ゆっくり",
      "今日",
      "明日",
      "今週中",
      "\\d{1,2}月\\d{1,2}日",
      "(月|火|水|木|金|土|日)曜(?:日)?まで?",
      "までに",
      "まで",
      "メモ",
      "タスク",
      "として",
      "お願い",
      "お願いします"
    ].join("|"),
    "g"
  );

  return transcript
    .replace(categoryRegex, " ")
    .replace(/[、。,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompletionTarget(transcript: string) {
  return transcript
    .replace(completionPattern, " ")
    .replace(/[、。,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(transcript: string, categories: Category[]) {
  const tokens = new Set<string>();
  const keywordCandidates = [
    "仕事",
    "プライベート",
    "Voicy",
    "ボイシー",
    "書籍",
    "原稿",
    "執筆",
    "会議",
    "部会",
    "準備",
    "作成",
    "提出",
    "入力",
    "連絡",
    "読書",
    "筋トレ",
    "ランニング",
    "モーニングページ"
  ];

  categories.forEach((category) => {
    if (transcript.includes(category.name)) {
      tokens.add(category.name);
    }
  });

  keywordCandidates.forEach((keyword) => {
    if (transcript.includes(keyword)) {
      tokens.add(keyword);
    }
  });

  return [...tokens];
}

function withDetectedTime(date: Date, transcript: string, fallbackHour: number, fallbackMinute: number) {
  const detected = new Date(date);
  const timeMatch = transcript.match(/(\d{1,2})[:時](\d{1,2})?/);

  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = timeMatch[2] ? Number(timeMatch[2]) : 0;
    detected.setHours(hours, minutes, 0, 0);
    return detected;
  }

  detected.setHours(fallbackHour, fallbackMinute, 0, 0);
  return detected;
}

function nextWeekday(baseDate: Date, targetDay: number) {
  const next = new Date(baseDate);
  next.setHours(0, 0, 0, 0);
  const currentDay = next.getDay();
  const delta = (targetDay - currentDay + 7) % 7;
  next.setDate(next.getDate() + delta);
  return next;
}

function mapWeekdayToNumber(weekday: string) {
  const map: Record<string, number> = {
    日: 0,
    月: 1,
    火: 2,
    水: 3,
    木: 4,
    金: 5,
    土: 6
  };

  return map[weekday];
}

function normalizeTranscript(transcript: string) {
  return transcript.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(text: string) {
  return text.replace(/[、。,.!！?？\s]/g, "").toLowerCase();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDateLabel(date: Date) {
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
