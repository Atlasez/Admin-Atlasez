export const applicationAttentionLabels = {
  new: "新規応募の確認",
  decision: "面談後の結果待ち",
  email: "メール送信失敗",
  conflict: "審査結果と応募状態の不一致",
} as const;

type AttentionReason = keyof typeof applicationAttentionLabels;
export type ApplicationAttentionFilter = "all" | "any" | AttentionReason;

export function parseApplicationAttentionFilter(
  value: string | null,
): ApplicationAttentionFilter {
  return value === "any" ||
    (value !== null && Object.hasOwn(applicationAttentionLabels, value))
    ? (value as ApplicationAttentionFilter)
    : "all";
}

export function applicationInterviewPath(
  project: string,
  application: string,
  attention: ApplicationAttentionFilter = "all",
): string {
  const params = new URLSearchParams({ application, project });
  if (attention !== "all") params.set("attention", attention);
  return `/admin/application-interview/?${params}`;
}

type ApplicationAttentionData = {
  status?: string | null;
  interview?: {
    completedAt?: string | null;
    completed_at?: string | null;
    status?: string | null;
  };
  interview_completed_at?: string | null;
  interview_status?: string | null;
  interview_finalized_at?: string | null;
  interview_decision?: string | null;
  email_deliveries?: { failed?: number }[];
};

export function applicationAttentionReasons(
  application: ApplicationAttentionData,
): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const open =
    application.status === "new" || application.status === "reviewing";
  const completed =
    Boolean(
      application.interview?.completedAt ??
      application.interview?.completed_at ??
      application.interview_completed_at,
    ) ||
    (application.interview?.status ?? application.interview_status) ===
      "completed";
  if (
    application.status === "new" &&
    !completed &&
    !application.interview_finalized_at
  )
    reasons.push("new");
  if (open && completed && !application.interview_finalized_at)
    reasons.push("decision");
  if (application.email_deliveries?.some(({ failed }) => (failed ?? 0) > 0))
    reasons.push("email");
  if (
    application.interview_finalized_at &&
    application.interview_decision !== application.status
  )
    reasons.push("conflict");
  return reasons;
}
