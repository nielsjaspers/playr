/** Apply a drop to the latest order. Stale queue drags cannot restore consumed rows. */
export function moveItemsBefore(
  currentIds: readonly string[],
  draggedIds: readonly string[],
  beforeId: string | null,
  allowNewItems = false,
) {
  const moving = [...new Set(draggedIds)].filter((id) => allowNewItems || currentIds.includes(id));
  if (moving.length === 0 || (beforeId != null && moving.includes(beforeId))) return [...currentIds];
  const remaining = currentIds.filter((id) => !moving.includes(id));
  const index = beforeId == null ? -1 : remaining.indexOf(beforeId);
  const destination = index < 0 ? remaining.length : index;
  return [...remaining.slice(0, destination), ...moving, ...remaining.slice(destination)];
}
