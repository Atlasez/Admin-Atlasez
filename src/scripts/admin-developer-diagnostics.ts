import type {
  ScheduledJobHealthItem,
  ScheduledJobHealthSnapshot,
} from "../lib/admin-scheduled-job-health";
import type { ScheduledQueueHealth } from "../lib/admin-scheduled-job-queues";
import { createAdminLoadRetry } from "./admin-load-retry";

type DiagnosticCheck = {
  id: string;
  label: string;
  status: string;
  detail: string;
  durationMs?: number;
};

type DeveloperDiagnosticsResponse = {
  error?: string;
  generatedAt?: string;
  prototypeAccess?: boolean;
  checks?: DiagnosticCheck[];
  scheduledJobs?: ScheduledJobHealthSnapshot;
  queues?: ScheduledQueueHealth[];
};

const statusLabels = {
  ok: "正常",
  warning: "確認が必要",
  error: "エラー",
  unknown: "未確認",
  running: "実行中",
} as const;

const node = <Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
  text?: string,
) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const statusBadge = (value: string) => {
  // 状態の判定はAPIを正本とし、画面ではラベルに変換するだけにする。
  const status = Object.hasOwn(statusLabels, value)
    ? (value as keyof typeof statusLabels)
    : "unknown";
  const badge = node("span", "diagnostic-status", statusLabels[status]);
  badge.dataset.status = status;
  return badge;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "medium",
});

const formatDate = (value: string | null | undefined) => {
  if (!value) return "記録なし";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? dateFormatter.format(date)
    : "日時を確認できません";
};

const timestamp = (value: string | null | undefined) => {
  const element = node("time", "", formatDate(value));
  if (value && Number.isFinite(new Date(value).getTime()))
    element.dateTime = value;
  return element;
};

const formatCount = (value: number | null | undefined, unit = "件") =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString("ja-JP")}${unit}`
    : "未取得";

const formatDuration = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "記録なし";
  return value < 1000
    ? `${Math.round(value)}ms`
    : `${(value / 1000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}秒`;
};

const formatAge = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "記録なし";
  const minutes = Math.floor(value / 60_000);
  if (minutes < 1) return "1分未満";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours}時間${minutes % 60 ? `${minutes % 60}分` : ""}`;
  return `${Math.floor(hours / 24)}日${hours % 24 ? `${hours % 24}時間` : ""}`;
};

const addField = (
  list: HTMLDListElement,
  label: string,
  value: string | HTMLElement,
) => {
  const description = node("dd", "");
  if (typeof value === "string") description.textContent = value;
  else description.append(value);
  list.append(node("dt", "", label), description);
};

const monitoringCard = (
  item: Pick<ScheduledJobHealthItem, "label" | "status" | "detail"> & {
    id: string;
  },
  kind: "job" | "queue",
) => {
  const card = node("article", "monitoring-card");
  card.dataset.monitoringKind = kind;
  card.dataset.monitoringId = item.id;
  const heading = node("div", "monitoring-card-heading");
  heading.append(node("h3", "", item.label), statusBadge(item.status));
  card.append(heading, node("p", "monitoring-card-detail", item.detail));
  return card;
};

const renderJob = (job: ScheduledJobHealthItem) => {
  const card = monitoringCard(job, "job");
  const fields = node("dl", "monitoring-card-meta");
  addField(fields, "確認先（役割）", job.ownerRole);
  addField(fields, "実行間隔", job.scheduleLabel);
  addField(fields, "最後の開始", timestamp(job.lastStartedAt));
  addField(fields, "最後の終了", timestamp(job.lastFinishedAt));
  addField(fields, "最後の成功", timestamp(job.lastSucceededAt));
  addField(fields, "最後の失敗", timestamp(job.lastFailedAt));
  addField(
    fields,
    "連続失敗（記録）",
    formatCount(job.consecutiveFailures, "回"),
  );
  addField(fields, "直近の処理時間", formatDuration(job.lastDurationMs));
  if (job.lastErrorCode) addField(fields, "エラーコード", job.lastErrorCode);
  card.append(fields);
  return card;
};

const renderQueue = (queue: ScheduledQueueHealth) => {
  const card = monitoringCard(queue, "queue");
  const fields = node("dl", "monitoring-card-meta");
  addField(fields, "確認先（役割）", queue.ownerRole);
  addField(fields, "未完了", formatCount(queue.pendingCount));
  addField(fields, "うち再試行待ち", formatCount(queue.retryCount));
  addField(fields, "要対応（24時間）", formatCount(queue.failedCount));
  addField(fields, "最も古い待機日時", timestamp(queue.oldestPendingAt));
  addField(fields, "最長待機時間", formatAge(queue.oldestPendingAgeMs));
  card.append(fields);
  return card;
};

const renderCheck = (check: DiagnosticCheck) => {
  const row = node("div", "diagnostic-row");
  row.append(
    node("span", "diagnostic-label", check.label),
    statusBadge(check.status),
    node("span", "diagnostic-detail", check.detail),
  );
  if (check.durationMs !== undefined)
    row.append(
      node("span", "diagnostic-duration", formatDuration(check.durationMs)),
    );
  return row;
};

const initializeDeveloperPage = () => {
  const root = document.querySelector<HTMLElement>("[data-developer-page]");
  if (!root || root.dataset.initialized === "true") return;
  root.dataset.initialized = "true";
  const state = root.querySelector<HTMLElement>("[data-diagnostic-state]")!;
  const list = root.querySelector<HTMLElement>("[data-diagnostic-list]")!;
  const generated = root.querySelector<HTMLElement>(
    "[data-diagnostic-generated]",
  )!;
  const retry = root.querySelector<HTMLButtonElement>(
    "[data-diagnostic-retry]",
  )!;
  const jobs = root.querySelector<HTMLElement>("[data-scheduled-jobs]")!;
  const jobState = root.querySelector<HTMLElement>("[data-scheduled-state]")!;
  const jobGenerated = root.querySelector<HTMLElement>(
    "[data-scheduled-generated]",
  )!;
  const queues = root.querySelector<HTMLElement>("[data-scheduled-queues]")!;
  const queueState = root.querySelector<HTMLElement>("[data-queue-state]")!;
  const timezone = root.querySelector<HTMLElement>(
    "[data-monitoring-timezone]",
  )!;
  timezone.textContent = `時刻は端末のタイムゾーン（${dateFormatter.resolvedOptions().timeZone}）で表示しています。`;
  let retryController: ReturnType<typeof createAdminLoadRetry> | null = null;
  let loading = false;

  const clearPreviousResult = () => {
    for (const container of [list, jobs, queues]) {
      container.hidden = true;
      container.replaceChildren();
    }
    root
      .querySelectorAll<HTMLElement>("[data-prototype-link]")
      .forEach((link) => {
        link.hidden = true;
      });
    for (const message of [jobState, queueState]) {
      message.hidden = false;
      message.dataset.state = "unknown";
      message.textContent = "確認しています…";
    }
    generated.textContent = "確認しています…";
    jobGenerated.textContent = "監視データ未取得";
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    retryController?.begin();
    clearPreviousResult();
    state.dataset.state = "loading";
    state.textContent = "確認しています…";
    state.hidden = false;
    retry.disabled = true;
    try {
      const response = await fetch("/api/admin/developer/diagnostics", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await response.json()) as DeveloperDiagnosticsResponse;
      if (!response.ok)
        throw new Error(
          data.error ||
            (response.status === 403
              ? "この診断情報を確認する権限がありません。"
              : "診断情報を取得できませんでした。"),
        );
      const checks = Array.isArray(data.checks) ? data.checks : [];
      list.replaceChildren(...checks.map(renderCheck));
      generated.textContent = data.generatedAt
        ? `最終確認：${formatDate(data.generatedAt)}（端末時刻）`
        : "確認時刻を取得できません";

      const snapshot = data.scheduledJobs;
      if (
        snapshot?.available === true &&
        Array.isArray(snapshot.jobs) &&
        snapshot.jobs.length
      ) {
        jobs.replaceChildren(...snapshot.jobs.map(renderJob));
        jobs.hidden = false;
        jobState.hidden = true;
        jobGenerated.textContent = `記録の取得時刻：${formatDate(snapshot.generatedAt)}（端末時刻）`;
      } else {
        jobState.textContent =
          "監視データ未取得。定期処理の実行結果を確認できていません。";
      }
      if (Array.isArray(data.queues) && data.queues.length) {
        queues.replaceChildren(...data.queues.map(renderQueue));
        queues.hidden = false;
        queueState.hidden = true;
      } else {
        queueState.textContent =
          "監視データ未取得。処理待ちの件数を確認できていません。";
      }
      root
        .querySelectorAll<HTMLElement>("[data-prototype-link]")
        .forEach((link) => {
          link.hidden = data.prototypeAccess !== true;
        });
      state.hidden = true;
      list.hidden = false;
      retryController?.success();
    } catch (error) {
      // 再取得に失敗した場合も、直前の正常表示を現在の状態として残さない。
      clearPreviousResult();
      state.hidden = true;
      generated.textContent = "確認に失敗";
      for (const message of [jobState, queueState])
        message.textContent = "監視データ未取得。最新の状態を確認できません。";
      retryController?.fail(error);
    } finally {
      loading = false;
      retry.disabled = false;
    }
  };

  retryController = createAdminLoadRetry(
    root,
    () => load(),
    "診断情報を取得できませんでした。",
  );
  retry.addEventListener("click", () => void load());
  void load();
};

document.addEventListener("astro:page-load", initializeDeveloperPage);
initializeDeveloperPage();
