/** The insertion slot is measured in the original list, before removing the group. */
export function movePageOrder(
  count: number,
  from: number | readonly number[],
  insertion: number,
): number[] {
  const group = typeof from === "number" ? [from] : from;
  const selected = new Set(group);
  if (
    !group.length ||
    selected.size !== group.length ||
    group.some((i) => !Number.isInteger(i) || i < 0 || i >= count) ||
    !Number.isInteger(insertion) ||
    insertion < 0 ||
    insertion > count
  )
    throw new Error("Ungültige Seitenposition.");
  const before: number[] = [],
    moved: number[] = [],
    after: number[] = [];
  for (let i = 0; i < count; i++) {
    if (selected.has(i)) moved.push(i);
    else if (i < insertion) before.push(i);
    else after.push(i);
  }
  return [...before, ...moved, ...after];
}
