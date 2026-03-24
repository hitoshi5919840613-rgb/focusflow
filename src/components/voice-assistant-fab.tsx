"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  convertVoiceMemoToTask,
  getRecentVoiceMemos,
  getSpeechRecognitionConstructor,
  handleVoiceTranscript,
  isMorningPageTime,
  supportsSpeechRecognition,
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
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [latestTranscript, setLatestTranscript] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [result, setResult] = useState<VoiceCommandOutcome | null>(null);
  const [recentMemos, setRecentMemos] = useState<VoiceMemoItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isConvertingMemoId, setIsConvertingMemoId] = useState<number | null>(null);
  const finalTranscriptRef = useRef("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    setIsSupported(supportsSpeechRecognition());
    void refreshMemos();
  }, []);

  async function refreshMemos() {
    const memos = await getRecentVoiceMemos(5);
    setRecentMemos(memos);
  }

  async function processTranscript(transcript: string) {
    if (!transcript.trim()) {
      return;
    }

    setLatestTranscript(transcript);
    setTextDraft("");
    setErrorMessage(undefined);

    try {
      const nextResult = await handleVoiceTranscript(transcript, mode);
      setResult(nextResult);
      setIsOpen(true);
      await refreshMemos();

      if (nextResult.kind === "created_task" || nextResult.kind === "completed_task") {
        await onTasksChanged();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "音声処理に失敗しました。";
      setErrorMessage(message);
    }
  }

  function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void processTranscript(textDraft.trim());
  }

  function startListening() {
    const Recognition = getSpeechRecognitionConstructor();

    if (!Recognition) {
      setErrorMessage("このブラウザでは音声認識が使えません。Chrome 系ブラウザでお試しください。");
      setIsOpen(true);
      return;
    }

    finalTranscriptRef.current = "";
    setInterimTranscript("");
    setLatestTranscript("");
    setResult(null);
    setErrorMessage(undefined);
    setIsOpen(true);

    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let nextFinal = "";
      let nextInterim = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const resultItem = event.results[index];
        const transcript = resultItem[0]?.transcript ?? "";
        if (resultItem.isFinal) {
          nextFinal += transcript;
        } else {
          nextInterim += transcript;
        }
      }

      if (nextFinal) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${nextFinal}`.trim();
      }

      setLatestTranscript(finalTranscriptRef.current);
      setInterimTranscript(nextInterim.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setErrorMessage("マイク権限が必要です。ブラウザでマイクを許可してください。");
      } else if (event.error !== "aborted") {
        setErrorMessage(`音声認識エラー: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      const transcript = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = "";
      setInterimTranscript("");
      if (transcript) {
        void processTranscript(transcript);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  async function handleConvertMemo(memoId: number) {
    try {
      setIsConvertingMemoId(memoId);
      setErrorMessage(undefined);
      const created = await convertVoiceMemoToTask(memoId);
      setResult({
        kind: "created_task",
        message: `ボイスメモから「${created.taskTitle}」をタスク化しました。`,
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
              <p className="text-sm font-semibold text-primary">Voice Hub</p>
              <h2 className="mt-1 text-lg font-semibold">音声入力アシスタント</h2>
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

          <div className="mt-4 rounded-[22px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/25">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Speech
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {isSupported
                ? "音声認識はブラウザ標準の Web Speech API を使います。解析は外部 API なしのローカルルールベースです。"
                : "このブラウザでは Web Speech API が使えません。"}
            </p>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={isListening ? stopListening : startListening}
                disabled={!isSupported}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition ${
                  isListening ? "bg-danger hover:bg-red-500" : "bg-primary hover:bg-blue-700"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isListening ? "録音を止める" : "録音を始める"}
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50/80 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
              <p className="font-medium">
                {isListening ? "聞き取り中..." : result ? "最新の認識結果" : "ここに音声テキストが表示されます"}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words">
                {interimTranscript || latestTranscript || "まだ音声はありません"}
              </p>
            </div>

            {errorMessage ? (
              <p className="mt-4 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <div className="mt-4 rounded-[22px] border border-slate-200/70 bg-white/55 p-4 dark:border-slate-700/70 dark:bg-slate-950/25">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Text
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              話せない場所では、ここに打ち込んでも同じローカル解析でタスク化やメモ保存ができます。
            </p>

            <form className="mt-4 space-y-3" onSubmit={handleTextSubmit}>
              <textarea
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                className="soft-input min-h-24 w-full rounded-2xl px-4 py-3 text-sm outline-none"
                placeholder="例: 明日までに体育のシラバスを作る、仕事、優先度高"
              />
              <button
                type="submit"
                disabled={!textDraft.trim()}
                className="w-full rounded-2xl bg-secondary px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                テキストを実行する
              </button>
            </form>
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
              <h3 className="text-sm font-semibold">最近のボイスメモ</h3>
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
                  まだボイスメモはありません。
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
        className={`fixed bottom-28 right-4 z-40 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-soft transition ${
          isListening
            ? "bg-danger hover:bg-red-500"
            : "bg-gradient-to-br from-primary to-secondary hover:scale-[1.02]"
        }`}
        aria-label="音声入力を開く"
      >
        <span className="text-2xl">{isListening ? "■" : "🎙"}</span>
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
