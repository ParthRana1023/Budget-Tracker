import { baseCurrency, formatExact, minorDigits, toMajor } from "./money.mjs";
import { methodLabel } from "./paymentMethods.mjs";

export function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Each amount in the base it was recorded in (Currency column: a base switch keeps older entries
 * as made); a foreign entry also shows what was typed ("$19.99").
 */
export function transactionsToCsv(transactions) {
  const columns = ["Date", "Type", "Category", "Amount", "Currency", "Note", "Payment method", "Original amount"];
  const rows = transactions.map((transaction) => {
    const currency = transaction.recorded_currency ?? transaction.base_currency ?? baseCurrency();
    return [
      transaction.date,
      transaction.type,
      transaction.category?.name,
      toMajor(Number(transaction.recorded_amount ?? transaction.amount), currency).toFixed(minorDigits(currency)),
      currency,
      transaction.note,
      methodLabel(transaction.payment_method),
      transaction.original_currency
        ? formatExact(Number(transaction.original_amount), transaction.original_currency)
        : "",
    ]
      .map(escapeCsv)
      .join(",");
  });

  return [columns.join(","), ...rows].join("\r\n");
}
