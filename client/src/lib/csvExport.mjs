import { methodLabel } from "./paymentMethods.mjs";

const CSV_COLUMNS = ["Date", "Type", "Category", "Amount (INR)", "Note", "Payment method"];

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function transactionsToCsv(transactions) {
  const rows = transactions.map((transaction) =>
    [
      transaction.date,
      transaction.type,
      transaction.category?.name,
      (Number(transaction.amount) / 100).toFixed(2),
      transaction.note,
      methodLabel(transaction.payment_method),
    ]
      .map(escapeCsv)
      .join(","),
  );

  return [CSV_COLUMNS.join(","), ...rows].join("\r\n");
}
