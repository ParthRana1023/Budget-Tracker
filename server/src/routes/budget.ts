import { Router } from "express";
import { calculateSafeToSpend, getPeriodRange } from "../services/budgetCalculator.js";

const router = Router();

// Endpoint to calculate safe-to-spend figure
router.post("/calculate", (req, res) => {
  try {
    const {
      confirmedIncome = 0,
      unreceivedVariableIncome = 0,
      targetSavings = 0,
      budgetedFixedBills = 0,
      paidFixedBills = 0,
      flexibleSpent = 0,
      daysRemainingInPeriod = 30,
    } = req.body;

    const values = {
      confirmedIncome: Number(confirmedIncome),
      unreceivedVariableIncome: Number(unreceivedVariableIncome),
      targetSavings: Number(targetSavings),
      budgetedFixedBills: Number(budgetedFixedBills),
      paidFixedBills: Number(paidFixedBills),
      flexibleSpent: Number(flexibleSpent),
      daysRemainingInPeriod: Number(daysRemainingInPeriod),
    };
    const rawValues = {
      confirmedIncome, unreceivedVariableIncome, targetSavings,
      budgetedFixedBills, paidFixedBills, flexibleSpent, daysRemainingInPeriod,
    };
    if (Object.entries(values).some(([key, value]) =>
      !Number.isFinite(value) ||
      (typeof rawValues[key as keyof typeof rawValues] === "string" &&
        (rawValues[key as keyof typeof rawValues] as string).trim() === "") ||
      (key === "daysRemainingInPeriod"
        ? !Number.isInteger(value) || value < 1
        : value < 0)
    )) {
      return res.status(400).json({ error: "Budget values must be finite, non-negative numbers and daysRemainingInPeriod must be at least 1." });
    }

    const summary = calculateSafeToSpend(values);
    res.json(summary);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Endpoint to compute period range for a given month_start_day
router.get("/period", (req, res) => {
  const rawStartDay = req.query.monthStartDay === undefined ? 1 : Number(req.query.monthStartDay);
  if (!Number.isInteger(rawStartDay) || rawStartDay < 1 || rawStartDay > 28) {
    return res.status(400).json({ error: "monthStartDay must be an integer from 1 to 28." });
  }
  const dateStr = req.query.date as string | undefined;
  const refDate = dateStr
    ? (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? new Date(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)))
        : new Date(dateStr))
    : new Date();
  if (Number.isNaN(refDate.getTime())) {
    return res.status(400).json({ error: "date must be a valid date." });
  }

  const range = getPeriodRange(refDate, rawStartDay);
  res.json({
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    daysRemaining: range.daysRemaining,
  });
});

export default router;

