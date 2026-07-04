/** Склонение «N заданий» для числа n ≥ 0. */
export function formatTasksCount(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return `${n} заданий`;
  if (d === 1) return `${n} задание`;
  if (d >= 2 && d <= 4) return `${n} задания`;
  return `${n} заданий`;
}

/** Склонение «N групп» для числа n ≥ 0. */
export function formatGroupsCount(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return `${n} групп`;
  if (d === 1) return `${n} группа`;
  if (d >= 2 && d <= 4) return `${n} группы`;
  return `${n} групп`;
}
