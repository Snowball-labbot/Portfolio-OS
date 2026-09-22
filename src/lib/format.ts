export function formatCny(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(Number(value || 0));
}

export function formatCompactCny(value: number) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 100_000_000) return `¥${(amount / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(amount) >= 10_000) return `¥${(amount / 10_000).toFixed(2)}万`;
  return formatCny(amount);
}

export function formatPercent(value: number, digits = 2) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

export function formatQuantity(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}
