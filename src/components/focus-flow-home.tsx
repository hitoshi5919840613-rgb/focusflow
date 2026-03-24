"use client";

import type { CSSProperties, FormEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { VoiceAssistantFab } from "@/components/voice-assistant-fab";
import {
  type Category,
  type NotificationSettings,
  type Priority,
  type TaskStatus
} from "@/lib/client/db";
import { generateDailyCoachSuggestion, type DailyCoachSuggestion } from "@/lib/services/coach-service";
import {
  buildMonthCalendar,
  buildWeekCalendar,
  getCalendarRangeLabel,
  getTasksForCalendarDate,
  isSameDate,
  setDateWithTime,
  shiftCalendarAnchor,
  startOfDay,
  type CalendarDay,
  type CalendarViewMode
} from "@/lib/services/calendar-service";
import {
  createTemplate,
  decomposeTaskFromTemplates,
  deleteTemplate,
  getTemplates,
  updateTemplate,
  type TemplateInput
} from "@/lib/services/decompose-service";
import {
  createTask,
  createSubtask,
  cycleTaskStatus,
  deleteTask,
  deleteSubtask,
  getAllTasks,
  getTaskComposerData,
  markTaskDone,
  toggleSubtaskStatus,
  updateTask,
  updateSubtask,
  type TaskViewItem
} from "@/lib/services/task-service";
import {
  buildNudgeNotification,
  formatScheduledTime,
  getNotificationPermissionState,
  getNotificationSettings,
  getNudgeTone,
  getUpcomingDeadlineNotifications,
  requestNotificationPermission,
  scheduleDeadlineNotifications,
  sendNudgeNotification,
  showPomodoroTransitionNotification,
  syncImmediateNotifications,
  updateNotificationSettings,
  type NotificationPermissionState,
  type ScheduledNotificationItem
} from "@/lib/services/notification-service";

type AppSection = "today" | "tasks" | "calendar" | "settings";
type TaskSortMode = "priority" | "due" | "recent";
type TaskStatusFilter = "open" | "done" | "all";

type TaskFormState = {
  title: string;
  categoryId: string;
  dueDate: string;
  priority: Priority;
  description: string;
};

type TaskFilters = {
  categoryId: string;
  sortBy: TaskSortMode;
  status: TaskStatusFilter;
};

type TemplateFormState = {
  keyword: string;
  stepsText: string;
};

type PomodoroPhase = "focus" | "break";

const initialFormState: TaskFormState = {
  title: "",
  categoryId: "",
  dueDate: "",
  priority: "medium",
  description: ""
};

const initialFilters: TaskFilters = {
  categoryId: "all",
  sortBy: "priority",
  status: "open"
};

const initialTemplateFormState: TemplateFormState = {
  keyword: "",
  stepsText: ""
};

const navItems: Array<{ id: AppSection; label: string; icon: string }> = [
  { id: "today", label: "今日", icon: "◉" },
  { id: "tasks", label: "一覧", icon: "☰" },
  { id: "calendar", label: "予定", icon: "◫" },
  { id: "settings", label: "設定", icon: "⚙" }
];

export function FocusFlowHome() {
  const [activeSection, setActiveSection] = useState<AppSection>("today");
  const [categories, setCategories] = useState<Category[]>([]);
  const [tasks, setTasks] = useState<TaskViewItem[]>([]);
  const [form, setForm] = useState<TaskFormState>(initialFormState);
  const [filters, setFilters] = useState<TaskFilters>(initialFilters);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof getTemplates>>>([]);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(initialTemplateFormState);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [celebratingTaskIds, setCelebratingTaskIds] = useState<number[]>([]);
  const [coachSuggestion, setCoachSuggestion] = useState<DailyCoachSuggestion | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>("unsupported");
  const [scheduledNotifications, setScheduledNotifications] = useState<ScheduledNotificationItem[]>([]);
  const [pomodoroTaskId, setPomodoroTaskId] = useState("");
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>("focus");
  const [pomodoroRemainingSeconds, setPomodoroRemainingSeconds] = useState(0);
  const [pomodoroIsRunning, setPomodoroIsRunning] = useState(false);
  const [pomodoroCompletedSessions, setPomodoroCompletedSessions] = useState(0);
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("month");
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => startOfDay(new Date()));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => startOfDay(new Date()));
  const [statusMessage, setStatusMessage] = useState("タスクを読み込み中です。");
  const [isBooting, setIsBooting] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const pomodoroTaskOptions = sortTasks(tasks.filter((task) => task.status !== "done"), "priority");
  const pomodoroTask = pomodoroTaskOptions.find((task) => String(task.id) === pomodoroTaskId);
  const monthCalendarDays = buildMonthCalendar(calendarAnchorDate, tasks);
  const weekCalendarDays = buildWeekCalendar(calendarAnchorDate, tasks);
  const visibleCalendarDays = calendarViewMode === "month" ? monthCalendarDays : weekCalendarDays;
  const selectedDayTasks = getTasksForCalendarDate(tasks, selectedCalendarDate);
  const selectedCalendarDay =
    visibleCalendarDays.find((day) => isSameDate(day.date, selectedCalendarDate)) ??
    monthCalendarDays.find((day) => isSameDate(day.date, selectedCalendarDate)) ??
    buildFallbackCalendarDay(selectedCalendarDate, selectedDayTasks);

  useEffect(() => {
    setNotificationPermission(getNotificationPermissionState());
    void refreshData();
  }, []);

  useEffect(() => {
    if (!notificationSettings) {
      return;
    }

    let active = true;
    let cancelScheduledNotifications = () => {};

    void syncImmediateNotifications(tasks, notificationSettings).then((upcoming) => {
      if (!active) {
        return;
      }

      const scheduled = scheduleDeadlineNotifications(tasks, notificationSettings);
      cancelScheduledNotifications = scheduled.cancel;
      setScheduledNotifications(scheduled.upcoming.slice(0, 6));

      if (scheduled.upcoming.length === 0) {
        setScheduledNotifications(upcoming.slice(0, 6));
      }
    });

    return () => {
      active = false;
      cancelScheduledNotifications();
    };
  }, [tasks, notificationPermission, notificationSettings]);

  useEffect(() => {
    if (!notificationSettings || tasks.length === 0) {
      return;
    }

    const intervalMs = Math.max(30, notificationSettings.nudgeIntervalMinutes) * 60 * 1000;
    const timerId = window.setInterval(() => {
      void sendNudgeNotification(tasks, notificationSettings);
    }, intervalMs);

    return () => window.clearInterval(timerId);
  }, [tasks, notificationPermission, notificationSettings]);

  useEffect(() => {
    if (pomodoroTaskId || tasks.length === 0) {
      return;
    }

    const suggestedTaskId = coachSuggestion?.taskId ?? tasks.find((task) => task.status !== "done")?.id;
    if (suggestedTaskId) {
      setPomodoroTaskId(String(suggestedTaskId));
    }
  }, [coachSuggestion?.taskId, pomodoroTaskId, tasks]);

  useEffect(() => {
    if (!pomodoroTaskId) {
      return;
    }

    const exists = tasks.some((task) => String(task.id) === pomodoroTaskId && task.status !== "done");
    if (!exists) {
      setPomodoroTaskId("");
    }
  }, [pomodoroTaskId, tasks]);

  useEffect(() => {
    if (!pomodoroIsRunning || pomodoroRemainingSeconds <= 0) {
      return;
    }

    const currentPhase = pomodoroPhase;
    const currentTaskTitle = pomodoroTask?.title;
    const currentSettings = notificationSettings;
    const timerId = window.setInterval(() => {
      setPomodoroRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timerId);
          setPomodoroIsRunning(false);
          void (async () => {
            if (currentPhase === "focus") {
              setPomodoroCompletedSessions((count) => count + 1);
              await showPomodoroTransitionNotification({
                type: "focus_end",
                taskTitle: currentTaskTitle
              });

              const breakMinutes = currentSettings?.breakMinutes ?? 5;
              setPomodoroPhase("break");
              setPomodoroRemainingSeconds(breakMinutes * 60);
              setPomodoroIsRunning(true);
              setStatusMessage("集中が終わりました。休憩タイマーを始めます。");
              return;
            }

            await showPomodoroTransitionNotification({
              type: "break_end",
              taskTitle: currentTaskTitle
            });
            setPomodoroPhase("focus");
            setPomodoroRemainingSeconds(0);
            setPomodoroIsRunning(false);
            setStatusMessage("休憩が終わりました。次の 1 セッションは好きなタイミングで始められます。");
          })();
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [notificationSettings, pomodoroIsRunning, pomodoroPhase, pomodoroRemainingSeconds, pomodoroTask?.title]);

  const todayTasks = sortTasks(
    tasks.filter((task) => {
      const celebrating = task.id ? celebratingTaskIds.includes(task.id) : false;
      if (task.status === "done" && !celebrating) {
        return false;
      }

      return celebrating || task.urgency !== "upcoming";
    }),
    "priority"
  );

  const filteredTasks = sortTasks(
    tasks.filter((task) => {
      if (filters.categoryId !== "all" && String(task.categoryId ?? "") !== filters.categoryId) {
        return false;
      }

      if (filters.status === "open" && task.status === "done") {
        return false;
      }

      if (filters.status === "done" && task.status !== "done") {
        return false;
      }

      return true;
    }),
    filters.sortBy
  );

  const openTaskCount = tasks.filter((task) => task.status !== "done").length;
  const completedTaskCount = tasks.filter((task) => task.status === "done").length;
  const overdueTaskCount = tasks.filter((task) => task.urgency === "overdue" && task.status !== "done").length;
  const upcomingNotificationPreview =
    notificationSettings ? getUpcomingDeadlineNotifications(tasks, notificationSettings).slice(0, 4) : [];
  const nudgePreview = notificationSettings ? buildNudgeNotification(tasks, notificationSettings) : null;
  const nudgeTone = getNudgeTone();

  async function refreshData() {
    try {
      setErrorMessage(undefined);
      setIsBooting(true);

      const [{ categories }, nextTasks, nextTemplates, nextNotificationSettings] = await Promise.all([
        getTaskComposerData(),
        getAllTasks(),
        getTemplates(),
        getNotificationSettings()
      ]);

      setCategories(categories);
      setTasks(nextTasks);
      setTemplates(nextTemplates);
      setNotificationSettings(nextNotificationSettings);
      setCoachSuggestion(generateDailyCoachSuggestion(nextTasks));
      setStatusMessage(
        nextTasks.length > 0
          ? `未完了 ${nextTasks.filter((task) => task.status !== "done").length} 件、完了 ${nextTasks.filter((task) => task.status === "done").length} 件です。`
          : "まだタスクはありません。最初の 1 件を追加してみましょう。"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "データの読み込みに失敗しました。";
      setErrorMessage(message);
      setStatusMessage("ホーム画面の初期化に失敗しました。");
    } finally {
      setIsBooting(false);
    }
  }

  async function handleRequestNotificationAccess() {
    const nextPermission = await requestNotificationPermission();
    setNotificationPermission(nextPermission);

    if (nextPermission === "granted") {
      setStatusMessage("通知を有効にしました。期限通知とナッジを届けられます。");
      return;
    }

    if (nextPermission === "denied") {
      setStatusMessage("通知はブラウザ側でブロックされています。必要ならブラウザ設定から変更できます。");
      return;
    }

    setStatusMessage("通知権限はまだ保留です。必要なタイミングでまた有効化できます。");
  }

  async function handleNotificationSettingsChange(
    input: Partial<Omit<NotificationSettings, "id">>
  ) {
    if (!notificationSettings) {
      return;
    }

    try {
      setErrorMessage(undefined);
      const updated = await updateNotificationSettings(input);
      setNotificationSettings(updated);
      setStatusMessage("通知設定を更新しました。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "通知設定の更新に失敗しました。";
      setErrorMessage(message);
    }
  }

  function handleStartPomodoro() {
    const focusMinutes = notificationSettings?.pomodoroMinutes ?? 25;
    setPomodoroPhase("focus");
    setPomodoroRemainingSeconds(focusMinutes * 60);
    setPomodoroIsRunning(true);
    setStatusMessage(
      pomodoroTask ? `「${pomodoroTask.title}」で集中モードを始めました。` : "集中モードを始めました。"
    );
  }

  function handlePausePomodoro() {
    setPomodoroIsRunning(false);
    setStatusMessage("ポモドーロを一時停止しました。再開はいつでもできます。");
  }

  function handleResumePomodoro() {
    if (pomodoroRemainingSeconds <= 0) {
      handleStartPomodoro();
      return;
    }

    setPomodoroIsRunning(true);
    setStatusMessage("ポモドーロを再開しました。");
  }

  function handleResetPomodoro() {
    setPomodoroIsRunning(false);
    setPomodoroPhase("focus");
    setPomodoroRemainingSeconds(0);
    setStatusMessage("ポモドーロをリセットしました。");
  }

  function handleSelectCalendarDate(date: Date) {
    const normalized = startOfDay(date);
    setSelectedCalendarDate(normalized);
    setCalendarAnchorDate(normalized);
    setErrorMessage(undefined);
  }

  function handleJumpCalendar(direction: -1 | 1) {
    setCalendarAnchorDate((current) => shiftCalendarAnchor(current, calendarViewMode, direction));
  }

  function handleJumpCalendarToday() {
    const today = startOfDay(new Date());
    setCalendarAnchorDate(today);
    setSelectedCalendarDate(today);
  }

  function handleCreateTaskForDate(date: Date) {
    const currentDueDate = form.dueDate ? new Date(form.dueDate) : undefined;
    const dueDate = setDateWithTime(date, currentDueDate);

    clearEditor();
    setSelectedCalendarDate(startOfDay(date));
    setCalendarAnchorDate(startOfDay(date));
    setForm({
      ...initialFormState,
      dueDate: formatInputDate(dueDate),
      categoryId: form.categoryId,
      priority: form.priority
    });
    setErrorMessage(undefined);
    setStatusMessage(`${formatCalendarTitle(date)} に向けた新しいタスクを追加できます。`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.title.trim()) {
      setErrorMessage("タスク名を入力してください。");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(undefined);

      if (editingTaskId) {
        const currentTask = tasks.find((task) => task.id === editingTaskId);
        await updateTask(editingTaskId, {
          title: form.title,
          categoryId: form.categoryId ? Number(form.categoryId) : undefined,
          dueDate: form.dueDate ? new Date(form.dueDate) : undefined,
          priority: form.priority,
          description: form.description,
          status: currentTask?.status
        });
        setStatusMessage("タスクを更新しました。");
      } else {
        await createTask({
          title: form.title,
          categoryId: form.categoryId ? Number(form.categoryId) : undefined,
          dueDate: form.dueDate ? new Date(form.dueDate) : undefined,
          priority: form.priority,
          description: form.description
        });
        setStatusMessage("新しいタスクを追加しました。");
      }

      clearEditor();
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "タスクの保存に失敗しました。";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTask(taskId: number) {
    const accepted = window.confirm("このタスクを削除しますか？");
    if (!accepted) {
      return;
    }

    try {
      setErrorMessage(undefined);
      await deleteTask(taskId);
      if (editingTaskId === taskId) {
        clearEditor();
      }
      setStatusMessage("タスクを削除しました。");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "タスクの削除に失敗しました。";
      setErrorMessage(message);
    }
  }

  async function handleCycleStatus(taskId: number) {
    try {
      setErrorMessage(undefined);
      const nextStatus = await cycleTaskStatus(taskId);
      applyLocalStatus(taskId, nextStatus);
      if (nextStatus === "done") {
        celebrateTask(taskId);
      } else {
        await refreshData();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "タスク状態の更新に失敗しました。";
      setErrorMessage(message);
    }
  }

  async function handleSwipeComplete(taskId: number) {
    try {
      setErrorMessage(undefined);
      await markTaskDone(taskId);
      applyLocalStatus(taskId, "done");
      celebrateTask(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "スワイプ完了に失敗しました。";
      setErrorMessage(message);
    }
  }

  function handleEditTask(task: TaskViewItem, targetSection: AppSection = "tasks") {
    setEditingTaskId(task.id ?? null);
    setForm({
      title: task.title,
      categoryId: task.categoryId ? String(task.categoryId) : "",
      dueDate: formatInputDate(task.dueDate),
      priority: task.priority,
      description: task.description ?? ""
    });
    if (task.dueDate) {
      setSelectedCalendarDate(startOfDay(task.dueDate));
      setCalendarAnchorDate(startOfDay(task.dueDate));
    }
    setActiveSection(targetSection);
    setErrorMessage(undefined);
    setStatusMessage(`「${task.title}」を編集中です。`);
  }

  function clearEditor() {
    setEditingTaskId(null);
    setForm(initialFormState);
  }

  function clearTemplateEditor() {
    setEditingTemplateId(null);
    setTemplateForm(initialTemplateFormState);
  }

  function applyLocalStatus(taskId: number, status: TaskStatus) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status,
              completedAt: status === "done" ? new Date() : undefined,
              urgency: status === "in_progress" ? "focus" : "upcoming",
              updatedAt: new Date()
            }
          : task
      )
    );
  }

  function celebrateTask(taskId: number) {
    setCelebratingTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
    window.setTimeout(() => {
      setCelebratingTaskIds((current) => current.filter((id) => id !== taskId));
      void refreshData();
    }, 900);
  }

  async function handleDecomposeTask() {
    if (!form.title.trim()) {
      setErrorMessage("分解する前にタスク名を入力してください。");
      return;
    }

    try {
      setIsDecomposing(true);
      setErrorMessage(undefined);

      let taskId = editingTaskId;

      if (taskId !== null) {
        const currentTask = tasks.find((task) => task.id === taskId);
        await updateTask(taskId, {
          title: form.title,
          categoryId: form.categoryId ? Number(form.categoryId) : undefined,
          dueDate: form.dueDate ? new Date(form.dueDate) : undefined,
          priority: form.priority,
          description: form.description,
          status: currentTask?.status
        });
      } else {
        taskId = await createTask({
          title: form.title,
          categoryId: form.categoryId ? Number(form.categoryId) : undefined,
          dueDate: form.dueDate ? new Date(form.dueDate) : undefined,
          priority: form.priority,
          description: form.description
        });
      }

      if (taskId === null) {
        throw new Error("分解対象のタスクを作成できませんでした。");
      }

      const result = await decomposeTaskFromTemplates(taskId, form.title);
      if (!result.template) {
        setStatusMessage("一致するテンプレートが見つからなかったので、今回は分解しませんでした。");
      } else if (result.createdSubtasks.length === 0) {
        setStatusMessage(`「${result.template.keyword}」テンプレートは見つかりましたが、追加できる新規サブタスクはありませんでした。`);
      } else {
        setStatusMessage(
          `「${result.template.keyword}」テンプレートから ${result.createdSubtasks.length} 件のサブタスクを追加しました。`
        );
      }

      if (editingTaskId === null) {
        clearEditor();
      }

      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "タスク分解に失敗しました。";
      setErrorMessage(message);
    } finally {
      setIsDecomposing(false);
    }
  }

  async function handleTemplateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input = buildTemplateInput(templateForm);
    if (!input) {
      setErrorMessage("テンプレートのキーワードとステップを入力してください。");
      return;
    }

    try {
      setIsSavingTemplate(true);
      setErrorMessage(undefined);

      if (editingTemplateId !== null) {
        await updateTemplate(editingTemplateId, input);
        setStatusMessage("テンプレートを更新しました。");
      } else {
        await createTemplate(input);
        setStatusMessage("カスタムテンプレートを追加しました。");
      }

      clearTemplateEditor();
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "テンプレートの保存に失敗しました。";
      setErrorMessage(message);
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(templateId: number) {
    const accepted = window.confirm("このテンプレートを削除しますか？");
    if (!accepted) {
      return;
    }

    try {
      await deleteTemplate(templateId);
      if (editingTemplateId === templateId) {
        clearTemplateEditor();
      }
      setStatusMessage("テンプレートを削除しました。");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "テンプレートの削除に失敗しました。";
      setErrorMessage(message);
    }
  }

  function handleEditTemplate(template: Awaited<ReturnType<typeof getTemplates>>[number]) {
    setEditingTemplateId(template.id ?? null);
    setTemplateForm({
      keyword: template.keyword,
      stepsText: template.steps.join("\n")
    });
    setActiveSection("settings");
  }

  async function handleCreateSubtask(parentTaskId: number, title: string) {
    try {
      await createSubtask(parentTaskId, title);
      setStatusMessage("サブタスクを追加しました。");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "サブタスクの追加に失敗しました。";
      setErrorMessage(message);
    }
  }

  async function handleUpdateSubtask(subtaskId: number, title: string) {
    try {
      await updateSubtask(subtaskId, { title });
      setStatusMessage("サブタスクを更新しました。");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "サブタスクの更新に失敗しました。";
      setErrorMessage(message);
    }
  }

  async function handleToggleSubtask(subtaskId: number) {
    try {
      await toggleSubtaskStatus(subtaskId);
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "サブタスク状態の変更に失敗しました。";
      setErrorMessage(message);
    }
  }

  async function handleDeleteSubtask(subtaskId: number) {
    try {
      await deleteSubtask(subtaskId);
      setStatusMessage("サブタスクを削除しました。");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "サブタスクの削除に失敗しました。";
      setErrorMessage(message);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-28 pt-6 sm:px-6">
      <header className="glass-card rounded-[32px] p-5 shadow-soft sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary">FocusFlow Home</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              今日やることを、今すぐ始めやすく
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              今日のタスク、期限通知、やさしいナッジ、ポモドーロまで、朝の立ち上がりをひと続きで回せるようにしています。
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <HeroStat label="未完了" value={String(openTaskCount)} />
          <HeroStat label="完了" value={String(completedTaskCount)} />
          <HeroStat label="期限超過" value={String(overdueTaskCount)} />
        </div>
      </header>

      {coachSuggestion ? (
        <section className="mt-5 glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-secondary">Daily Coach</p>
              <h2 className="mt-2 text-xl font-semibold">{coachSuggestion.headline}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                {coachSuggestion.body}
              </p>
            </div>
            <span className="rounded-full bg-secondary/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              今日はここから
            </span>
          </div>
        </section>
      ) : null}

      <main className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        {activeSection === "today" ? (
          <>
            <section>
              <div className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">今日のタスク</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{statusMessage}</p>
                  </div>
                  <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Today View
                  </span>
                </div>

                <p className="mt-4 text-xs leading-6 text-slate-500 dark:text-slate-400">
                  右にスワイプすると一気に完了できます。タップ操作では「状態変更」で未着手 → 進行中 → 完了と進みます。
                </p>

                <div className="mt-5 space-y-3">
                  {isBooting ? (
                    <TaskSkeleton />
                  ) : todayTasks.length > 0 ? (
                    todayTasks.map((task) => (
                      <SwipeTaskCard
                        key={task.id}
                        task={task}
                        celebrate={task.id ? celebratingTaskIds.includes(task.id) : false}
                        onCreateSubtask={handleCreateSubtask}
                        onDeleteSubtask={handleDeleteSubtask}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                        onCycleStatus={handleCycleStatus}
                        onSwipeComplete={handleSwipeComplete}
                        onToggleSubtask={handleToggleSubtask}
                        onUpdateSubtask={handleUpdateSubtask}
                      />
                    ))
                  ) : (
                    <EmptyState
                      title="まだ今日のフォーカスタスクはありません"
                      description="期限を今日にしたタスクや、進行中のタスクがここに出ます。まずは 1 件追加してみましょう。"
                    />
                  )}
                </div>
              </div>
            </section>

            <aside>
              <div className="space-y-5">
                <TaskEditorPanel
                  categories={categories}
                  editingTaskId={editingTaskId}
                  errorMessage={errorMessage}
                  form={form}
                  isSubmitting={isSubmitting}
                  isDecomposing={isDecomposing}
                  onCancel={clearEditor}
                  onChange={setForm}
                  onDecompose={handleDecomposeTask}
                  onSubmit={handleSubmit}
                />
                <PomodoroPanel
                  completedSessions={pomodoroCompletedSessions}
                  isRunning={pomodoroIsRunning}
                  phase={pomodoroPhase}
                  remainingSeconds={pomodoroRemainingSeconds}
                  selectedTaskId={pomodoroTaskId}
                  taskOptions={pomodoroTaskOptions}
                  settings={notificationSettings}
                  onPause={handlePausePomodoro}
                  onReset={handleResetPomodoro}
                  onResume={handleResumePomodoro}
                  onSelectTask={setPomodoroTaskId}
                  onStart={handleStartPomodoro}
                />
              </div>
            </aside>
          </>
        ) : null}

        {activeSection === "tasks" ? (
          <>
            <section>
              <div className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">タスク一覧</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        カテゴリで絞り込み、優先度や期限で並び替えながら、編集・削除・状態変更ができます。
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {filteredTasks.length} 件表示
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium">カテゴリ</span>
                      <select
                        value={filters.categoryId}
                        onChange={(event) =>
                          setFilters((current) => ({ ...current, categoryId: event.target.value }))
                        }
                        className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="all">すべて</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium">並び替え</span>
                      <select
                        value={filters.sortBy}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            sortBy: event.target.value as TaskSortMode
                          }))
                        }
                        className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="priority">優先度順</option>
                        <option value="due">期限が近い順</option>
                        <option value="recent">更新が新しい順</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium">表示状態</span>
                      <select
                        value={filters.status}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            status: event.target.value as TaskStatusFilter
                          }))
                        }
                        className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="open">未完了のみ</option>
                        <option value="all">すべて</option>
                        <option value="done">完了のみ</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {isBooting ? (
                    <TaskSkeleton />
                  ) : filteredTasks.length > 0 ? (
                    filteredTasks.map((task) => (
                      <SwipeTaskCard
                        key={task.id}
                        task={task}
                        celebrate={task.id ? celebratingTaskIds.includes(task.id) : false}
                        onCreateSubtask={handleCreateSubtask}
                        onDeleteSubtask={handleDeleteSubtask}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                        onCycleStatus={handleCycleStatus}
                        onSwipeComplete={handleSwipeComplete}
                        onToggleSubtask={handleToggleSubtask}
                        onUpdateSubtask={handleUpdateSubtask}
                      />
                    ))
                  ) : (
                    <EmptyState
                      title="条件に合うタスクがありません"
                      description="フィルター条件をゆるめるか、新しいタスクを追加するとここに表示されます。"
                    />
                  )}
                </div>
              </div>
            </section>

            <aside>
              <div className="space-y-5">
                <TaskEditorPanel
                  categories={categories}
                  editingTaskId={editingTaskId}
                  errorMessage={errorMessage}
                  form={form}
                  isSubmitting={isSubmitting}
                  isDecomposing={isDecomposing}
                  onCancel={clearEditor}
                  onChange={setForm}
                  onDecompose={handleDecomposeTask}
                  onSubmit={handleSubmit}
                />
                <PomodoroPanel
                  completedSessions={pomodoroCompletedSessions}
                  isRunning={pomodoroIsRunning}
                  phase={pomodoroPhase}
                  remainingSeconds={pomodoroRemainingSeconds}
                  selectedTaskId={pomodoroTaskId}
                  taskOptions={pomodoroTaskOptions}
                  settings={notificationSettings}
                  onPause={handlePausePomodoro}
                  onReset={handleResetPomodoro}
                  onResume={handleResumePomodoro}
                  onSelectTask={setPomodoroTaskId}
                  onStart={handleStartPomodoro}
                />
              </div>
            </aside>
          </>
        ) : null}

        {activeSection === "calendar" ? (
          <>
            <section>
              <div className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
                <CalendarPanel
                  activeDate={selectedCalendarDate}
                  days={visibleCalendarDays}
                  mode={calendarViewMode}
                  rangeLabel={getCalendarRangeLabel(calendarAnchorDate, calendarViewMode)}
                  onJump={handleJumpCalendar}
                  onSelectDate={handleSelectCalendarDate}
                  onToday={handleJumpCalendarToday}
                  onViewModeChange={setCalendarViewMode}
                />
              </div>
            </section>

            <aside>
              <div className="space-y-5">
                <SelectedDayPanel
                  day={selectedCalendarDay}
                  onCreateTask={() => handleCreateTaskForDate(selectedCalendarDate)}
                  onEditTask={(task) => handleEditTask(task, "calendar")}
                />
                <TaskEditorPanel
                  categories={categories}
                  editingTaskId={editingTaskId}
                  errorMessage={errorMessage}
                  form={form}
                  isSubmitting={isSubmitting}
                  isDecomposing={isDecomposing}
                  onCancel={clearEditor}
                  onChange={setForm}
                  onDecompose={handleDecomposeTask}
                  onSubmit={handleSubmit}
                />
              </div>
            </aside>
          </>
        ) : null}

        {activeSection === "settings" ? (
          <section className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6 lg:col-span-2">
            <div className="space-y-5">
              <NotificationSettingsPanel
                notificationPermission={notificationPermission}
                scheduledNotifications={scheduledNotifications.length > 0 ? scheduledNotifications : upcomingNotificationPreview}
                settings={notificationSettings}
                nudgePreview={nudgePreview}
                nudgeToneLabel={nudgeTone.title}
                onRequestPermission={handleRequestNotificationAccess}
                onUpdateSetting={handleNotificationSettingsChange}
              />
              <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                <TemplateEditorPanel
                  editingTemplateId={editingTemplateId}
                  form={templateForm}
                  isSaving={isSavingTemplate}
                  onCancel={clearTemplateEditor}
                  onChange={setTemplateForm}
                  onSubmit={handleTemplateSubmit}
                />
                <TemplateListPanel
                  templates={templates}
                  onDelete={handleDeleteTemplate}
                  onEdit={handleEditTemplate}
                />
              </div>
            </div>
          </section>
        ) : null}
      </main>

      <nav className="fixed inset-x-4 bottom-4 z-20 mx-auto max-w-xl lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2">
        <div className="glass-card grid grid-cols-4 rounded-[28px] p-2 shadow-soft">
          {navItems.map((item) => {
            const isActive = item.id === activeSection;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`rounded-[22px] px-2 py-3 text-center transition ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-900/50"
                }`}
              >
                <span className="block text-base leading-none">{item.icon}</span>
                <span className="mt-1 block text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <VoiceAssistantFab onTasksChanged={refreshData} />
    </div>
  );
}

function TaskEditorPanel({
  categories,
  editingTaskId,
  errorMessage,
  form,
  isDecomposing,
  isSubmitting,
  onCancel,
  onChange,
  onDecompose,
  onSubmit
}: {
  categories: Category[];
  editingTaskId: number | null;
  errorMessage?: string;
  form: TaskFormState;
  isDecomposing: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  onChange: (value: TaskFormState | ((current: TaskFormState) => TaskFormState)) => void;
  onDecompose: () => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const isEditing = editingTaskId !== null;

  return (
    <div className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{isEditing ? "タスクを編集" : "タスクを追加"}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {isEditing ? "内容を更新して保存できます。" : "思いついた瞬間にテキストで追加できます。"}
          </p>
        </div>
        {isEditing ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:text-slate-200"
          >
            新規に戻す
          </button>
        ) : null}
      </div>

      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">タスク名</span>
          <input
            value={form.title}
            onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))}
            className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            placeholder="例: 体育のシラバスを作成する"
            maxLength={120}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">カテゴリ</span>
            <select
              value={form.categoryId}
              onChange={(event) => onChange((current) => ({ ...current, categoryId: event.target.value }))}
              className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            >
              <option value="">未分類</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">優先度</span>
            <select
              value={form.priority}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  priority: event.target.value as Priority
                }))
              }
              className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            >
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium">期限</span>
          <input
            type="datetime-local"
            value={form.dueDate}
            onChange={(event) => onChange((current) => ({ ...current, dueDate: event.target.value }))}
            className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium">メモ</span>
          <textarea
            value={form.description}
            onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
            className="soft-input min-h-28 w-full rounded-2xl px-4 py-3 text-base outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            placeholder="補足や次にやることを残せます"
            maxLength={240}
          />
        </label>

        {errorMessage ? (
          <p className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "保存中..." : isEditing ? "更新を保存する" : "タスクを追加する"}
        </button>

        <button
          type="button"
          onClick={() => void onDecompose()}
          disabled={isDecomposing}
          className="w-full rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-3 text-base font-semibold text-emerald-700 transition hover:bg-secondary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
        >
          {isDecomposing ? "分解中..." : isEditing ? "分解してサブタスク追加" : "分解して保存"}
        </button>
      </form>
    </div>
  );
}

function TemplateEditorPanel({
  editingTemplateId,
  form,
  isSaving,
  onCancel,
  onChange,
  onSubmit
}: {
  editingTemplateId: number | null;
  form: TemplateFormState;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (value: TemplateFormState | ((current: TemplateFormState) => TemplateFormState)) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const isEditing = editingTemplateId !== null;

  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-white/55 p-5 dark:border-slate-700/70 dark:bg-slate-950/25">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{isEditing ? "テンプレートを編集" : "テンプレートを追加"}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            キーワードと手順を登録しておくと、タスクをワンタップで分解できます。
          </p>
        </div>
        {isEditing ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            新規に戻す
          </button>
        ) : null}
      </div>

      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">キーワード</span>
          <input
            value={form.keyword}
            onChange={(event) => onChange((current) => ({ ...current, keyword: event.target.value }))}
            className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none"
            placeholder="例: 作成, 書く, 企画"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium">ステップ</span>
          <textarea
            value={form.stepsText}
            onChange={(event) => onChange((current) => ({ ...current, stepsText: event.target.value }))}
            className="soft-input min-h-40 w-full rounded-2xl px-4 py-3 text-base outline-none"
            placeholder={"1 行に 1 ステップずつ入力\n例:\n情報を集める\n構成を決める\nドラフトを書く"}
          />
        </label>

        <button
          type="submit"
          disabled={isSaving}
          className="w-full rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {isSaving ? "保存中..." : isEditing ? "テンプレートを更新" : "テンプレートを追加"}
        </button>
      </form>
    </div>
  );
}

function TemplateListPanel({
  templates,
  onDelete,
  onEdit
}: {
  templates: Awaited<ReturnType<typeof getTemplates>>;
  onDelete: (templateId: number) => Promise<void>;
  onEdit: (template: Awaited<ReturnType<typeof getTemplates>>[number]) => void;
}) {
  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-white/55 p-5 dark:border-slate-700/70 dark:bg-slate-950/25">
      <h2 className="text-xl font-semibold">登録済みテンプレート</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        デフォルトテンプレートもここで確認できます。キーワードはカンマ区切りで複数登録できます。
      </p>

      <div className="mt-5 space-y-3">
        {templates.map((template) => (
          <article
            key={template.id}
            className="rounded-[22px] border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/70 dark:bg-slate-900/45"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">{template.keyword}</p>
                <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  {template.steps.map((step, index) => (
                    <li key={`${template.id}-${index}`}>{`${index + 1}. ${step}`}</li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(template)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  編集
                </button>
                {typeof template.id === "number" ? (
                  <button
                    type="button"
                    onClick={() => void onDelete(template.id as number)}
                    className="rounded-full border border-danger/30 px-3 py-1 text-xs font-medium text-danger"
                  >
                    削除
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function NotificationSettingsPanel({
  notificationPermission,
  scheduledNotifications,
  settings,
  nudgePreview,
  nudgeToneLabel,
  onRequestPermission,
  onUpdateSetting
}: {
  notificationPermission: NotificationPermissionState;
  scheduledNotifications: ScheduledNotificationItem[];
  settings: NotificationSettings | null;
  nudgePreview: ScheduledNotificationItem | null;
  nudgeToneLabel: string;
  onRequestPermission: () => Promise<void>;
  onUpdateSetting: (input: Partial<Omit<NotificationSettings, "id">>) => Promise<void>;
}) {
  const permissionCopy = {
    granted: {
      label: "通知オン",
      tone: "text-emerald-700 dark:text-emerald-300",
      description: "期限通知とナッジをこの端末で受け取れます。"
    },
    denied: {
      label: "通知ブロック中",
      tone: "text-danger",
      description: "ブラウザ設定で通知の許可を戻すと、ここから再開できます。"
    },
    default: {
      label: "未設定",
      tone: "text-amber-700 dark:text-amber-300",
      description: "まずは通知を許可すると、期限と集中の合図を出せます。"
    },
    unsupported: {
      label: "非対応",
      tone: "text-slate-600 dark:text-slate-300",
      description: "このブラウザでは通知機能が使えません。"
    }
  }[notificationPermission];

  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-white/55 p-5 dark:border-slate-700/70 dark:bg-slate-950/25">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">通知とナッジ</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            期限の 1 日前・3 時間前・1 時間前の通知に加えて、時間帯に合わせたやさしいナッジを出します。
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200/70 bg-white/70 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/45">
          <p className={`text-sm font-semibold ${permissionCopy.tone}`}>{permissionCopy.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{permissionCopy.description}</p>
          {notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
            <button
              type="button"
              onClick={() => void onRequestPermission()}
              className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              通知を有効にする
            </button>
          ) : null}
        </div>
      </div>

      {settings ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <ToggleCard
                checked={settings.notify1DayBefore}
                description="前日"
                label="1日前通知"
                onToggle={() =>
                  void onUpdateSetting({
                    notify1DayBefore: !settings.notify1DayBefore
                  })
                }
              />
              <ToggleCard
                checked={settings.notify3HoursBefore}
                description="余裕づくり"
                label="3時間前"
                onToggle={() =>
                  void onUpdateSetting({
                    notify3HoursBefore: !settings.notify3HoursBefore
                  })
                }
              />
              <ToggleCard
                checked={settings.notify1HourBefore}
                description="直前ケア"
                label="1時間前"
                onToggle={() =>
                  void onUpdateSetting({
                    notify1HourBefore: !settings.notify1HourBefore
                  })
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">ナッジ間隔</span>
                <select
                  value={settings.nudgeIntervalMinutes}
                  onChange={(event) =>
                    void onUpdateSetting({ nudgeIntervalMinutes: Number(event.target.value) })
                  }
                  className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none"
                >
                  {[60, 90, 120, 180, 240].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes}分ごと
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">集中時間</span>
                <select
                  value={settings.pomodoroMinutes}
                  onChange={(event) =>
                    void onUpdateSetting({ pomodoroMinutes: Number(event.target.value) })
                  }
                  className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none"
                >
                  {[15, 20, 25, 30, 40].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes}分
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium">休憩時間</span>
                <select
                  value={settings.breakMinutes}
                  onChange={(event) =>
                    void onUpdateSetting({ breakMinutes: Number(event.target.value) })
                  }
                  className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none"
                >
                  {[3, 5, 10, 15].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes}分
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[22px] border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/70 dark:bg-slate-900/45">
              <p className="text-sm font-semibold">今のナッジトーン</p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{nudgeToneLabel}</p>
              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {nudgePreview ? nudgePreview.body : "未完了タスクがあると、ここに次のひと押し文面が出ます。"}
              </p>
            </div>

            <div className="rounded-[22px] border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/70 dark:bg-slate-900/45">
              <p className="text-sm font-semibold">次の通知予定</p>
              <div className="mt-3 space-y-2">
                {scheduledNotifications.length > 0 ? (
                  scheduledNotifications.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-3 dark:border-slate-700/70 dark:bg-slate-950/50"
                    >
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {formatScheduledTime(item.scheduledFor)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                    近い期限の通知はまだありません。期限付きタスクを追加するとここに並びます。
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToggleCard({
  checked,
  description,
  label,
  onToggle
}: {
  checked: boolean;
  description: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-[22px] border px-4 py-4 text-left transition ${
        checked
          ? "border-secondary/40 bg-secondary/10"
          : "border-slate-200/70 bg-white/70 dark:border-slate-700/70 dark:bg-slate-900/45"
      }`}
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      <p
        className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
          checked
            ? "bg-secondary text-white"
            : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        }`}
      >
        {checked ? "オン" : "オフ"}
      </p>
    </button>
  );
}

function PomodoroPanel({
  completedSessions,
  isRunning,
  phase,
  remainingSeconds,
  selectedTaskId,
  settings,
  taskOptions,
  onPause,
  onReset,
  onResume,
  onSelectTask,
  onStart
}: {
  completedSessions: number;
  isRunning: boolean;
  phase: PomodoroPhase;
  remainingSeconds: number;
  selectedTaskId: string;
  settings: NotificationSettings | null;
  taskOptions: TaskViewItem[];
  onPause: () => void;
  onReset: () => void;
  onResume: () => void;
  onSelectTask: (taskId: string) => void;
  onStart: () => void;
}) {
  const focusMinutes = settings?.pomodoroMinutes ?? 25;
  const breakMinutes = settings?.breakMinutes ?? 5;
  const phaseLabel = remainingSeconds > 0 ? (phase === "focus" ? "集中中" : "休憩中") : "待機中";
  const primaryActionLabel =
    isRunning ? "一時停止" : remainingSeconds > 0 ? "再開する" : `${focusMinutes}分集中する`;

  return (
    <div className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">ポモドーロ</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {focusMinutes} 分集中して、終わったら {breakMinutes} 分の休憩を通知します。
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {`完了 ${completedSessions} 回`}
        </span>
      </div>

      <div className="mt-5 rounded-[24px] border border-primary/15 bg-gradient-to-br from-primary/10 via-white/40 to-secondary/10 p-5 dark:from-primary/15 dark:via-slate-950/30 dark:to-secondary/10">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{phaseLabel}</p>
        <p className="mt-2 text-5xl font-semibold tracking-tight">{formatCountdown(remainingSeconds)}</p>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {phase === "focus" && remainingSeconds > 0
            ? "今は 1 つだけに集中して、終わったらアプリが休憩を知らせます。"
            : phase === "break" && remainingSeconds > 0
              ? "少し体を動かしたり、目線を遠くに向ける時間にちょうどいいです。"
              : "始めるタスクを選んで、1 セッションだけでも回してみましょう。"}
        </p>
      </div>

      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium">集中するタスク</span>
        <select
          value={selectedTaskId}
          onChange={(event) => onSelectTask(event.target.value)}
          className="soft-input w-full rounded-2xl px-4 py-3 text-base outline-none"
        >
          <option value="">タスクを選ばずに始める</option>
          {taskOptions.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={isRunning ? onPause : onResume}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          {remainingSeconds > 0 ? primaryActionLabel : "集中を始める"}
        </button>
        {remainingSeconds <= 0 ? (
          <button
            type="button"
            onClick={onStart}
            className="rounded-full border border-secondary/30 bg-secondary/10 px-4 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
          >
            タイマーをセット
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          リセット
        </button>
      </div>
    </div>
  );
}

function CalendarPanel({
  activeDate,
  days,
  mode,
  rangeLabel,
  onJump,
  onSelectDate,
  onToday,
  onViewModeChange
}: {
  activeDate: Date;
  days: CalendarDay[];
  mode: CalendarViewMode;
  rangeLabel: string;
  onJump: (direction: -1 | 1) => void;
  onSelectDate: (date: Date) => void;
  onToday: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
}) {
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">カレンダー</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            月間と週間を切り替えながら、期限タスクを日付で見渡せます。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <CalendarModeButton active={mode === "month"} label="月間" onClick={() => onViewModeChange("month")} />
          <CalendarModeButton active={mode === "week"} label="週間" onClick={() => onViewModeChange("week")} />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4 rounded-[24px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/25 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onJump(-1)}
            className="rounded-full border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            前へ
          </button>
          <button
            type="button"
            onClick={onToday}
            className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary"
          >
            今日へ
          </button>
          <button
            type="button"
            onClick={() => onJump(1)}
            className="rounded-full border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            次へ
          </button>
        </div>

        <div>
          <p className="text-lg font-semibold">{rangeLabel}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            タップするとその日の期限タスクと作成フォームが連動します。
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {["日", "月", "火", "水", "木", "金", "土"].map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>

      <div className={`mt-2 grid gap-2 ${mode === "month" ? "grid-cols-7" : "grid-cols-1 sm:grid-cols-7"}`}>
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            onClick={() => onSelectDate(day.date)}
            className={`min-h-28 rounded-[22px] border p-3 text-left transition ${
              isSameDate(day.date, activeDate)
                ? "border-primary bg-primary/10 shadow-[0_12px_30px_rgba(37,99,235,0.12)]"
                : day.overdueCount > 0
                  ? "border-danger/30 bg-red-50/70 dark:bg-red-950/15"
                  : "border-slate-200/70 bg-white/70 dark:border-slate-700/70 dark:bg-slate-950/30"
            } ${day.isCurrentMonth ? "" : "opacity-55"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p
                  className={`text-sm font-semibold ${
                    day.isToday ? "text-primary" : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {day.date.getDate()}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {day.openCount > 0 ? `未完了 ${day.openCount}` : "タスクなし"}
                </p>
              </div>
              {day.isToday ? (
                <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-white">今日</span>
              ) : null}
            </div>

            <div className="mt-3 space-y-1">
              {day.tasks.slice(0, 2).map((task) => (
                <div
                  key={task.id}
                  className="truncate rounded-full px-2 py-1 text-[11px] font-medium text-white"
                  style={{ backgroundColor: task.categoryColor }}
                >
                  {task.title}
                </div>
              ))}
              {day.tasks.length > 2 ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{`+${day.tasks.length - 2} 件`}</p>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CalendarModeButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-primary text-white"
          : "border border-slate-200/80 text-slate-700 dark:border-slate-700 dark:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function SelectedDayPanel({
  day,
  onCreateTask,
  onEditTask
}: {
  day: CalendarDay;
  onCreateTask: () => void;
  onEditTask: (task: TaskViewItem) => void;
}) {
  return (
    <div className="glass-card rounded-[28px] p-5 shadow-soft sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{formatCalendarTitle(day.date)}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {day.tasks.length > 0
              ? `${day.tasks.length} 件の期限タスクがあります。ここから編集にも入れます。`
              : "まだ期限タスクはありません。この日付で新しいタスクを追加できます。"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateTask}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          この日で追加
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {day.tasks.length > 0 ? (
          day.tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onEditTask(task)}
              className="w-full rounded-[22px] border border-slate-200/70 bg-white/70 p-4 text-left transition hover:border-primary/30 hover:bg-primary/5 dark:border-slate-700/70 dark:bg-slate-950/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{task.title}</p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {formatDueDate(task.dueDate)}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-medium text-white"
                  style={{ backgroundColor: task.categoryColor }}
                >
                  {task.categoryName}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Badge>{priorityLabel(task.priority)}</Badge>
                <Badge>{statusLabel(task.status)}</Badge>
                {task.progress.total > 0 ? <Badge>{`進捗 ${task.progress.done}/${task.progress.total}`}</Badge> : null}
              </div>
            </button>
          ))
        ) : (
          <EmptyState
            title="この日はまだ空いています"
            description="会議や締切が決まっているものから、ここに置いておくと見通しが作りやすいです。"
          />
        )}
      </div>
    </div>
  );
}

function SwipeTaskCard({
  task,
  celebrate,
  onCreateSubtask,
  onDeleteSubtask,
  onEdit,
  onDelete,
  onCycleStatus,
  onSwipeComplete,
  onToggleSubtask,
  onUpdateSubtask
}: {
  task: TaskViewItem;
  celebrate: boolean;
  onCreateSubtask: (parentTaskId: number, title: string) => Promise<void>;
  onDeleteSubtask: (subtaskId: number) => Promise<void>;
  onEdit: (task: TaskViewItem) => void;
  onDelete: (taskId: number) => Promise<void>;
  onCycleStatus: (taskId: number) => Promise<void>;
  onSwipeComplete: (taskId: number) => Promise<void>;
  onToggleSubtask: (subtaskId: number) => Promise<void>;
  onUpdateSubtask: (subtaskId: number, title: string) => Promise<void>;
}) {
  const [dragX, setDragX] = useState(0);
  const [pointerStart, setPointerStart] = useState<number | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState("");
  const isDone = task.status === "done";
  const isOverdue = task.urgency === "overdue" && !isDone;

  const urgencyCopy = {
    overdue: { label: "期限超過", tone: "text-red-600 dark:text-red-300", dot: "bg-danger" },
    today: { label: "今日が期限", tone: "text-amber-700 dark:text-amber-300", dot: "bg-accent" },
    focus: { label: "進行中", tone: "text-emerald-700 dark:text-emerald-300", dot: "bg-secondary" },
    upcoming: { label: isDone ? "完了" : "これから", tone: "text-slate-600 dark:text-slate-300", dot: "bg-slate-400" }
  }[task.urgency];

  async function handlePointerEnd() {
    if (pointerStart === null) {
      return;
    }

    const taskId = typeof task.id === "number" ? task.id : null;
    const shouldComplete = dragX > 112 && !isDone && taskId !== null;

    setPointerStart(null);
    setDragX(0);

    if (shouldComplete && taskId !== null) {
      await onSwipeComplete(taskId);
    }
  }

  function stopGesture(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
  }

  async function handleAddSubtask() {
    if (!task.id || !newSubtaskTitle.trim()) {
      return;
    }

    await onCreateSubtask(task.id, newSubtaskTitle);
    setNewSubtaskTitle("");
  }

  async function handleSaveEditedSubtask() {
    if (!editingSubtaskId || !editingSubtaskTitle.trim()) {
      return;
    }

    await onUpdateSubtask(editingSubtaskId, editingSubtaskTitle);
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
  }

  return (
    <div className="relative overflow-hidden rounded-[26px]">
      <div className="absolute inset-0 rounded-[26px] bg-gradient-to-r from-secondary via-emerald-500 to-primary p-[1px]">
        <div className="flex h-full items-center rounded-[25px] bg-emerald-500/90 px-5 text-white">
          <div>
            <p className="text-sm font-semibold">スワイプで完了</p>
            <p className="mt-1 text-xs text-emerald-50">今日の勢いをそのまま前に進めます</p>
          </div>
        </div>
      </div>

      <article
        className={`relative rounded-[26px] border p-4 transition ${
          isOverdue
            ? "border-danger/40 bg-red-50/80 shadow-[0_0_0_1px_rgba(239,68,68,0.06)] dark:bg-red-950/20"
            : "border-slate-200/75 bg-white/80 dark:border-slate-700/70 dark:bg-slate-950/45"
        } ${isDone ? "opacity-80" : ""}`}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: pointerStart === null ? "transform 180ms ease-out" : "none",
          touchAction: "pan-y"
        }}
        onPointerDown={(event) => {
          if (isDone) {
            return;
          }
          setPointerStart(event.clientX);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (pointerStart === null || isDone) {
            return;
          }
          const nextDrag = Math.max(0, Math.min(event.clientX - pointerStart, 148));
          setDragX(nextDrag);
        }}
        onPointerUp={async () => {
          await handlePointerEnd();
        }}
        onPointerCancel={() => {
          setPointerStart(null);
          setDragX(0);
        }}
      >
        {celebrate ? <CompletionBurst /> : null}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${urgencyCopy.dot}`} />
              <span className={`text-xs font-semibold ${urgencyCopy.tone}`}>{urgencyCopy.label}</span>
            </div>
            <h3 className={`mt-2 text-base font-semibold leading-6 ${isDone ? "line-through opacity-70" : ""}`}>
              {task.title}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: task.categoryColor }}
            >
              {task.categoryName}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Badge>{priorityLabel(task.priority)}</Badge>
          <Badge>{statusLabel(task.status)}</Badge>
          <Badge>{formatDueDate(task.dueDate)}</Badge>
          {task.progress.total > 0 ? (
            <Badge>{`進捗 ${task.progress.done}/${task.progress.total}`}</Badge>
          ) : null}
        </div>

        {task.description ? (
          <p className={`mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300 ${isDone ? "opacity-70" : ""}`}>
            {task.description}
          </p>
        ) : null}

        <div className="mt-4 rounded-[22px] border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-900/45">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">サブタスク</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {task.progress.total > 0
                  ? task.nextSubtask
                    ? `次は「${task.nextSubtask.title}」です`
                    : "すべてのサブタスクが完了しています"
                  : "まだサブタスクはありません"}
              </p>
            </div>
            {task.progress.total > 0 ? (
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-secondary transition-all"
                  style={{
                    width: `${Math.max(8, (task.progress.done / task.progress.total) * 100)}%`
                  }}
                />
              </div>
            ) : null}
          </div>

          {task.subtasks.length > 0 ? (
            <div className="mt-4 space-y-2">
              {task.subtasks.map((subtask) => {
                const isEditingSubtask = editingSubtaskId === subtask.id;
                return (
                  <div
                    key={subtask.id}
                    className="flex items-center gap-2 rounded-2xl bg-white/80 px-3 py-2 dark:bg-slate-950/50"
                  >
                    <button
                      type="button"
                      onClick={() => void onToggleSubtask(subtask.id as number)}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm transition ${
                        subtask.status === "done"
                          ? "border-secondary bg-secondary text-white"
                          : "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {subtask.status === "done" ? "✓" : "○"}
                    </button>

                    {isEditingSubtask ? (
                      <input
                        value={editingSubtaskTitle}
                        onChange={(event) => setEditingSubtaskTitle(event.target.value)}
                        className="soft-input flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                      />
                    ) : (
                      <p
                        className={`flex-1 text-sm ${subtask.status === "done" ? "line-through opacity-60" : ""}`}
                      >
                        {subtask.title}
                      </p>
                    )}

                    {isEditingSubtask ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleSaveEditedSubtask()}
                          className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSubtaskId(null);
                            setEditingSubtaskTitle("");
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          戻す
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSubtaskId(subtask.id ?? null);
                            setEditingSubtaskTitle(subtask.title);
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteSubtask(subtask.id as number)}
                          className="rounded-full border border-danger/30 px-3 py-1 text-xs font-medium text-danger"
                        >
                          削除
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {typeof task.id === "number" ? (
            <div className="mt-4 flex gap-2">
              <input
                value={newSubtaskTitle}
                onChange={(event) => setNewSubtaskTitle(event.target.value)}
                className="soft-input flex-1 rounded-2xl px-4 py-3 text-sm outline-none"
                placeholder="サブタスクを追加"
              />
              <button
                type="button"
                onClick={() => void handleAddSubtask()}
                className="rounded-2xl bg-secondary/15 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
              >
                追加
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2" onPointerDown={stopGesture}>
          {typeof task.id === "number" ? (
            <>
              <button
                type="button"
                onClick={() => void onCycleStatus(task.id as number)}
                className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
              >
                {nextActionLabel(task.status)}
              </button>
              <button
                type="button"
                onClick={() => onEdit(task)}
                className="rounded-full border border-slate-200/80 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:text-slate-200"
              >
                編集
              </button>
              <button
                type="button"
                onClick={() => void onDelete(task.id as number)}
                className="rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
              >
                削除
              </button>
            </>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function CompletionBurst() {
  const pieces = [
    { x: "-64px", y: "-42px", r: "-18deg", color: "#F59E0B", delay: "0ms" },
    { x: "-28px", y: "-58px", r: "14deg", color: "#10B981", delay: "40ms" },
    { x: "16px", y: "-56px", r: "26deg", color: "#2563EB", delay: "80ms" },
    { x: "58px", y: "-28px", r: "34deg", color: "#F97316", delay: "20ms" },
    { x: "64px", y: "18px", r: "22deg", color: "#F59E0B", delay: "70ms" },
    { x: "18px", y: "52px", r: "-10deg", color: "#10B981", delay: "10ms" },
    { x: "-26px", y: "48px", r: "-24deg", color: "#2563EB", delay: "55ms" },
    { x: "-60px", y: "12px", r: "-30deg", color: "#F97316", delay: "95ms" }
  ];

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="completion-ring" />
      {pieces.map((piece, index) => (
        <span
          // This animation relies on CSS custom properties to fan particles outward.
          key={`${piece.x}-${piece.y}-${index}`}
          className="completion-burst-piece"
          style={
            {
              backgroundColor: piece.color,
              animationDelay: piece.delay,
              ["--burst-x" as string]: piece.x,
              ["--burst-y" as string]: piece.y,
              ["--burst-r" as string]: piece.r
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/25 bg-white/65 p-4 dark:bg-slate-950/30">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 dark:border-slate-700 dark:bg-slate-900/70">
      {children}
    </span>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-300/80 bg-white/45 p-6 text-center dark:border-slate-700 dark:bg-slate-950/20">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="animate-pulse rounded-[24px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/30"
        >
          <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-3 h-5 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-4 h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

function sortTasks(tasks: TaskViewItem[], sortBy: TaskSortMode) {
  const copy = [...tasks];
  const priorityWeight: Record<Priority, number> = {
    high: 0,
    medium: 1,
    low: 2
  };

  if (sortBy === "due") {
    return copy.sort(
      (a, b) =>
        (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
        priorityWeight[a.priority] - priorityWeight[b.priority] ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  if (sortBy === "recent") {
    return copy.sort(
      (a, b) =>
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        priorityWeight[a.priority] - priorityWeight[b.priority]
    );
  }

  return copy.sort(
    (a, b) =>
      priorityWeight[a.priority] - priorityWeight[b.priority] ||
      urgencyWeight(a) - urgencyWeight(b) ||
      (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      a.sortOrder - b.sortOrder
  );
}

function urgencyWeight(task: TaskViewItem) {
  const weights = {
    overdue: 0,
    today: 1,
    focus: 2,
    upcoming: 3
  };

  return weights[task.urgency];
}

function priorityLabel(priority: Priority) {
  if (priority === "high") return "優先度: 高";
  if (priority === "low") return "優先度: 低";
  return "優先度: 中";
}

function statusLabel(status: TaskStatus) {
  if (status === "in_progress") return "進行中";
  if (status === "done") return "完了";
  return "未着手";
}

function nextActionLabel(status: TaskStatus) {
  if (status === "todo") return "進行中へ";
  if (status === "in_progress") return "完了にする";
  return "未着手へ戻す";
}

function formatDueDate(dueDate?: Date) {
  if (!dueDate) {
    return "期限なし";
  }

  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(start.getDate() + 1);
  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(tomorrow.getDate() + 1);

  const time = dueDate.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  });

  if (dueDate >= start && dueDate < tomorrow) {
    return `今日 ${time}`;
  }

  if (dueDate >= tomorrow && dueDate < dayAfterTomorrow) {
    return `明日 ${time}`;
  }

  return dueDate.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatInputDate(dueDate?: Date) {
  if (!dueDate) {
    return "";
  }

  const year = dueDate.getFullYear();
  const month = `${dueDate.getMonth() + 1}`.padStart(2, "0");
  const day = `${dueDate.getDate()}`.padStart(2, "0");
  const hours = `${dueDate.getHours()}`.padStart(2, "0");
  const minutes = `${dueDate.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatCountdown(totalSeconds: number) {
  if (totalSeconds <= 0) {
    return "00:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatCalendarTitle(date: Date) {
  return date.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function buildFallbackCalendarDay(date: Date, tasks: TaskViewItem[]): CalendarDay {
  return {
    key: `fallback-${date.toISOString()}`,
    date,
    isToday: isSameDate(date, new Date()),
    isCurrentMonth: true,
    tasks,
    openCount: tasks.filter((task) => task.status !== "done").length,
    overdueCount: tasks.filter((task) => task.urgency === "overdue" && task.status !== "done").length
  };
}

function buildTemplateInput(form: TemplateFormState): TemplateInput | null {
  const keyword = form.keyword.trim();
  const steps = form.stepsText
    .split("\n")
    .map((step) => step.trim())
    .filter(Boolean);

  if (!keyword || steps.length === 0) {
    return null;
  }

  return {
    keyword,
    steps
  };
}
