// INR formatting from paise (integer minor units). Plain JS so .mjs modules and tests can use it.

/**
 * Format paise as a short INR string: whole rupees with Indian grouping, lakhs as "₹1.2L".
 * @param {number} paise
 * @returns {string}
 */
export function formatINR(paise) {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 100000) {
    return `₹${(rupees / 100000).toFixed(1)}L`;
  }
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

/**
 * Format paise as a decimal INR string (for detailed views).
 * @param {number} paise
 * @returns {string}
 */
export function formatINRDecimal(paise) {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Design-handoff rupee format from paise: whole rupees, Indian grouping, never
 * abbreviated, with a true minus sign ("₹1,00,000", "−₹650").
 * @param {number} paise
 * @returns {string}
 */
export function inr(paise) {
  const rupees = Math.round(Math.abs(paise) / 100);
  return `${paise <= -50 ? "−" : ""}₹${rupees.toLocaleString("en-IN")}`;
}
