import type { ConflictAlert, ConflictSeverity, ScheduleItem } from "./types";

export function rangesOverlap(
  a: Pick<ScheduleItem, "startAt" | "endAt">,
  b: Pick<ScheduleItem, "startAt" | "endAt">
) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export function getConflictSeverity(
  a: Pick<ScheduleItem, "status">,
  b: Pick<ScheduleItem, "status">
): ConflictSeverity {
  if (a.status === "confirmed" && b.status === "confirmed") {
    return "high";
  }

  if (a.status === "confirmed" || b.status === "confirmed") {
    return "medium";
  }

  return "low";
}

export function detectConflicts(
  items: ScheduleItem[],
  target?: ScheduleItem
): ConflictAlert[] {
  const alerts: ConflictAlert[] = [];
  const sourceItems = target ? [target] : items;

  for (const itemA of sourceItems) {
    for (const itemB of items) {
      if (itemA.id === itemB.id) {
        continue;
      }

      if (itemA.eventGroupId && itemA.eventGroupId === itemB.eventGroupId) {
        continue;
      }

      if (!target && itemA.id > itemB.id) {
        continue;
      }

      if (!rangesOverlap(itemA, itemB)) {
        continue;
      }

      alerts.push({
        id: [itemA.id, itemB.id].sort().join(":"),
        severity: getConflictSeverity(itemA, itemB),
        startsAt: itemA.startAt > itemB.startAt ? itemA.startAt : itemB.startAt,
        endsAt: itemA.endAt < itemB.endAt ? itemA.endAt : itemB.endAt,
        itemA,
        itemB
      });
    }
  }

  return alerts.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return (
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.startsAt.getTime() - b.startsAt.getTime()
    );
  });
}
