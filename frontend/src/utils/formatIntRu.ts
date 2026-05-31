/** Число с разрядами по-русски (например 2 400). */
export function formatIntRu(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}
