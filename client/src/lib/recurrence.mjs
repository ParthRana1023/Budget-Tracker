export function isRecurringItemDue(item, transactions, today = new Date()) {
  if (!item.active || today.getDate() < item.day_of_month) return false;
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  return !transactions.some((transaction) => transaction.external_id === `recurring:${item.id}:${monthKey}`);
}
