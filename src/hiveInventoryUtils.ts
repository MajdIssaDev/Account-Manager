import type { HiveInventoryItem, HiveSendManyResult } from "../shared/types";

export function itemsFromResult(result: HiveSendManyResult): HiveInventoryItem[] {
  const raw = result.data?.items;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw)
      : [];
  return list.filter((row) => row && typeof row === "object") as HiveInventoryItem[];
}

export function itemNamesFromResult(result: HiveSendManyResult): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of itemsFromResult(result)) {
    const name = String(item.name || "").trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Items every connected client returned (AND / intersection). */
export function intersectItemNames(results: HiveSendManyResult[], clientCount: number): string[] {
  const countByName = new Map<string, number>();
  for (const result of results) {
    for (const name of itemNamesFromResult(result)) {
      countByName.set(name, (countByName.get(name) || 0) + 1);
    }
  }
  return Array.from(countByName.entries())
    .filter(([, count]) => count === clientCount)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}
