export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="glass-card w-full max-w-lg rounded-[32px] p-8 shadow-soft">
        <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Offline Ready
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">通信がなくても大丈夫です</h1>
        <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">
          FocusFlow はブラウザ内の IndexedDB にデータを保存するので、オフラインでも今日のタスク確認や入力を続けられる設計です。
        </p>
        <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
          ネットワーク復帰後は PWA のキャッシュとローカルデータを使って、普段どおり再開できます。
        </p>
      </section>
    </main>
  );
}
