export function movePageOrder(
  count: number,
  from: number,
  insertion: number,
): number[] {
  if (
    !Number.isInteger(from) ||
    from < 0 ||
    from >= count ||
    !Number.isInteger(insertion) ||
    insertion < 0 ||
    insertion > count
  )
    throw new Error("Ungültige Seitenposition.");
  const order = Array.from({ length: count }, (_, i) => i);
  order.splice(from, 1);
  order.splice(insertion > from ? insertion - 1 : insertion, 0, from);
  return order;
}
