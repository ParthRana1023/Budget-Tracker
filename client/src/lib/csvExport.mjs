import { baseCurrency, formatExact, minorDigits, toMajor } from "./money.mjs";
import { methodLabel } from "./paymentMethods.mjs";

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Amounts in the base currency; a foreign entry also shows what was typed ("$19.99"). */
export function transactionsToCsv(transactions) {
  const columns = [
    "Date",
    "Type",
    "Category",
    `Amount (${baseCurrency()})`,
    "Note",
    "Payment method",
    "Original amount",
  ];
  const rows = transactions.map((transaction) =>
    [
      transaction.date,
      transaction.type,
      transaction.category?.name,
      toMajor(Number(transaction.amount)).toFixed(minorDigits()),
      transaction.note,
      methodLabel(transaction.payment_method),
      transaction.original_currency
        ? formatExact(Number(transaction.original_amount), transaction.original_currency)
        : "",
    ]
      .map(escapeCsv)
      .join(","),
  );

  return [columns.join(","), ...rows].join("\r\n");
}
