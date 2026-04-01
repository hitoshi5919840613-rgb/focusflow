"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  convertVoiceMemoToTask,
  getRecentVoiceMemos,
  handleVoiceTranscript,
  isMorningPageTime,
  type VoiceCaptureMode,
  type VoiceCommandOutcome,
  type VoiceMemoItem
} from "@/lib/services/voice-service";

export function VoiceAssistantFab({
  onTasksChanged
}: {
  onTasksChanged: () => Promise<void> | void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<VoiceCaptureMode>(isMorningPageTime() ? "memo" : "auto");
  const [textDraft, setTextDraft] = useState("");
  const [result, setResult] = useState<VoiceCommandOutcome | null>(null);
  const [recentMemos, setRecentMemos] = useState<VoiceMemoItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isConvertingMemoId, setIsConvertingMemoId] = useState<number | null>(null);
  const [autoTaskify, setAutoTaskify] = useState(true);

  useEffect(() => {
    const savedSetting = window.localStorage.getItem("focusflow-voice-autotaskify");
    if (savedSetting === "off") {
      setAutoTaskify(false);
    }
    void refreshMemos();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("focusflow-voice-autotaskify", autoTaskify ? "on" : "off");
  }, [autoTaskify]);

  async function refreshMemos() {
    const memos = await getRecentVoiceMemos(5);
    setRecentMemos(memos);
  }

  const processTranscript = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) {
        return;
      }

      setTextDraft("");
      setErrorMessage(undefined);

      try {
        const nextResult = await handleVoiceTranscript(transcript, mode);
        let finalResult = nextResult;

        if (
          autoTaskify &&
          nextResult.kind === "saved_memo" &&
          nextResult.memoType === "task_candidate" &&
          typeof nextResult.memoId === "number"
        ) {
          const created = await convertVoiceMemoToTask(nextResult.memoId);
          finalResult = {
            kind: "created_task",
            message: `メモから「${created.taskTitle}」をタスク化しました。`,
            transcript,
            taskId: created.taskId,
            taskDraft: {
              title: created.taskTitle,
              priority: "medium"
            }
          };
        }

        setResult(finalResult);
        setIsOpen(true);
        await refreshMemos();

        if (finalResult.kind === "created_task" || finalResult.kind === "completed_task") {
          await onTasksChanged();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "入力処理に失敗しました。";
        setErrorMessage(message);
      }
    },
    [autoTaskify, mode, onTasksChanged]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const importText = params.get("import") || params.get("text");
    if (!importText) {
      return;
    }

    setIsOpen(true);
    void processTranscript(importText);

    params.delete("import");
    params.delete("text");
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, [processTranscript]);

  function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void processTranscript(textDraft.trim());
  }

  async function handlePasteFromClipboard(runImmediately = false) {
    if (!navigator.clipboard?.readText) {
      setErrorMessage("このブラウザではクリップボード読み取りが使えません。");
      return;
    }

    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) {
        setErrorMessage("クリップボードにテキストがありません。");
        return;
      }

      setErrorMessage(undefined);

      if (runImmediately) {
        void processTranscript(clipText);
        return;
      }

      setTextDraft(clipText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "クリップボードの読み取りに失敗しました。";
      setErrorMessage(message);
    }
  }

  async function handleConvertMemo(memoId: number) {
    try {
      setIsConvertingMemoId(memoId);
      setErrorMessage(undefined);
      const created = await convertVoiceMemoToTask(memoId);
      setResult({
        kind: "created_task",
        message: `メモから「${created.taskTitle}」をタスク化しました。`,
        transcript: "",
        taskId: created.taskId,
        taskDraft: {
          title: created.taskTitle,
          priority: "medium"
        }
      });
      await refreshMemos();
      await onTasksChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "メモのタスク化に失敗しました。";
      setErrorMessage(message);
    } finally {
      setIsConvertingMemoId(null);
    }
  }

  return (
    <>
      {isOpen ? (
        <section className="glass-card fixed bottom-48 right-4 z-30 w-[min(92vw,24rem)] rounded-[28px] p-5 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">Input Hub</p>
              <h2 className="mt-1 text-lg font-semibold">テキスト入力アシスタント</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full border border-slate-200/80 px-3 py-1 text-sm text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:text-slate-200"
            >
              閉じる
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <ModeChip
              active={mode === "auto"}
              label="自動"
              onClick={() => setMode("auto")}
            />
            <ModeChip
              active={mode === "task"}
              label="タスク"
              onClick={() => setMode("task")}
            />
            <ModeChip
              active={mode === "memo"}
              label={isMorningPageTime() ? "朝メモ" : "メモ"}
              onClick={() => setMode("memo")}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-full border border-slate-200/70 bg-white/70 px-4 py-2 text-sm dark:border-slate-700/70 dark:bg-slate-950/30">
            <div>
              <p className="font-medium">タスク自動化</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">タスク候補なら自動で作成</p>
            </div>
            <button
              type="button"
              onClick={() => setAutoTaskify((current) => !current)}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                autoTaskify
                  ? "bg-secondary text-white"
                  : "border border-slate-200/80 text-slate-700 dark:border-slate-700 dark:text-slate-200"
              }`}
            >
              {autoTaskify ? "オン" : "オフ"}
            </button>
          </div>

          <div className="mt-4 rounded-[22px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/25">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Text
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              iOS のボイスメモ文字起こしをコピーして貼り付ければ、ここからタスク化できます。
            </p>

            <form className="mt-4 space-y-3" onSubmit={handleTextSubmit}>
              <textarea
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                className="soft-input min-h-24 w-full rounded-2xl px-4 py-3 text-sm outline-none"
                placeholder="例: 明日までに体育のシラバスを作る、仕事、優先度高"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handlePasteFromClipboard(false)}
                  className="rounded-2xl border border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:text-slate-200"
                >
                  クリップボードを貼り付け
                </button>
                <button
                  type="button"
                  onClick={() => void handlePasteFromClipboard(true)}
                  className="rounded-2xl bg-secondary px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                >
                  貼り付けて実行
                </button>
              </div>
              <button
                type="submit"
                disabled={!textDraft.trim()}
                className="w-full rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-secondary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
              >
                入力したテキストを実行
              </button>
            </form>

            {errorMessage ? (
              <p className="mt-4 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                {errorMessage}
              </p>
            ) : null}
          </div>

          {result ? (
            <div className="mt-4 rounded-[22px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/25">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                Result
              </p>
              <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">{result.message}</p>
              {"tasks" in result ? (
                <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {result.tasks.map((task) => (
                    <li key={task.id} className="rounded-2xl bg-slate-50/80 px-3 py-2 dark:bg-slate-900/70">
                      <span className="font-medium">{task.title}</span>
                      <span className="ml-2 text-xs">{formatTaskVoiceMeta(task)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">最近のメモ</h3>
              {isMorningPageTime() ? (
                <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Morning Page
                </span>
              ) : null}
            </div>

            <div className="mt-3 space-y-3">
              {recentMemos.length > 0 ? (
                recentMemos.map((memo) => (
                  <article
                    key={memo.id}
                    className="rounded-[22px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/25"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {memoTypeLabel(memo.memoType)}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {memo.recordedAt.toLocaleString("ja-JP", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">{memo.transcript}</p>

                    {memo.linkedTaskTitle ? (
                      <p className="mt-3 text-xs text-secondary">連携済み: {memo.linkedTaskTitle}</p>
                    ) : null}

                    {memo.memoType === "task_candidate" && !memo.linkedTaskId && typeof memo.id === "number" ? (
                      <button
                        type="button"
                        onClick={() => void handleConvertMemo(memo.id as number)}
                        disabled={isConvertingMemoId === memo.id}
                        className="mt-3 rounded-full bg-secondary/15 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-secondary/25 dark:text-emerald-300"
                      >
                        {isConvertingMemoId === memo.id ? "変換中..." : "タスク化する"}
                      </button>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="rounded-[22px] border border-dashed border-slate-300/80 bg-white/45 px-4 py-5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/20 dark:text-slate-300">
                  まだメモはありません。
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
        className="fixed bottom-28 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-white shadow-soft transition hover:scale-[1.02]"
        aria-label="テキスト入力を開く"
      >
        <span className="text-2xl">Aa</span>
      </button>
    </>
  );
}

function ModeChip({
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
          : "border border-slate-200/80 text-slate-700 hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function memoTypeLabel(memoType: VoiceMemoItem["memoType"]) {
  if (memoType === "morning_page") return "モーニングページ";
  if (memoType === "task_candidate") return "タスク候補";
  return "メモ";
}

function formatTaskVoiceMeta(task: { categoryName: string; priority: string; dueDate?: Date }) {
  const dueDate = task.dueDate
    ? task.dueDate.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "期限なし";
  return `${task.categoryName} / ${task.priority} / ${dueDate}`;
}
