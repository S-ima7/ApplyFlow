import type {
  ApplicationRoute,
  ApplicationStatus,
  ApplicationType,
  DeadlineStatus,
  DeadlineType,
  InterviewStatus,
  Priority,
  ProposedSlotStatus,
  StageStatus,
  StageType
} from "@prisma/client";

export const applicationTypeLabels: Record<ApplicationType, string> = {
  JOB_HUNTING: "就職活動",
  CAREER_CHANGE: "転職",
  INTERNSHIP: "インターン",
  FREELANCE: "業務委託",
  PART_TIME: "アルバイト",
  GRADUATE_SCHOOL: "大学院",
  OTHER: "その他"
};

export const applicationRouteLabels: Record<ApplicationRoute, string> = {
  DIRECT: "直接応募",
  AGENT: "エージェント",
  REFERRAL: "リファラル",
  JOB_BOARD: "求人媒体",
  SCOUT: "スカウト",
  SNS: "SNS",
  OTHER: "その他"
};

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  DRAFT: "下書き",
  APPLIED: "応募済み",
  DOCUMENT_SCREENING: "書類選考中",
  INTERVIEWING: "面接中",
  OFFERED: "オファー",
  ACCEPTED: "承諾",
  DECLINED: "辞退",
  REJECTED: "不採用",
  WITHDRAWN: "取り下げ",
  CLOSED: "終了"
};

export const priorityLabels: Record<Priority, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  TOP: "最優先"
};

export const stageTypeLabels: Record<StageType, string> = {
  DOCUMENT_SCREENING: "書類選考",
  CASUAL_MEETING: "カジュアル面談",
  FIRST_INTERVIEW: "一次面接",
  SECOND_INTERVIEW: "二次面接",
  FINAL_INTERVIEW: "最終面接",
  OFFER_MEETING: "オファー面談",
  CONDITION_MEETING: "条件面談",
  ASSIGNMENT: "課題",
  OTHER: "その他"
};

export const stageStatusLabels: Record<StageStatus, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "進行中",
  WAITING_REPLY: "返信待ち",
  SCHEDULED: "予定あり",
  COMPLETED: "完了",
  SKIPPED: "スキップ",
  CANCELLED: "キャンセル"
};

export const interviewStatusLabels: Record<InterviewStatus, string> = {
  DRAFT: "下書き",
  PROPOSED: "候補提示済み",
  WAITING_REPLY: "返信待ち",
  CONFIRMED: "確定",
  COMPLETED: "完了",
  CANCELLED: "キャンセル",
  EXPIRED: "期限切れ"
};

export const proposedSlotStatusLabels: Record<ProposedSlotStatus, string> = {
  PENDING: "提示中",
  CONFIRMED: "確定",
  REJECTED: "非選択",
  CANCELLED: "キャンセル",
  EXPIRED: "期限切れ"
};

export const deadlineTypeLabels: Record<DeadlineType, string> = {
  REPLY_DEADLINE: "返信期限",
  OFFER_ACCEPTANCE: "承諾期限",
  DOCUMENT_SUBMISSION: "書類提出",
  ASSIGNMENT_SUBMISSION: "課題提出",
  INTERVIEW_PREPARATION: "面接準備",
  OTHER: "その他"
};

export const deadlineStatusLabels: Record<DeadlineStatus, string> = {
  OPEN: "未完了",
  DONE: "完了",
  EXPIRED: "期限切れ",
  CANCELLED: "キャンセル"
};
