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

    const summary = calculateSafeToSpend({
      confirmedIncome: Number(confirmedIncome),
      unreceivedVariableIncome: Number(unreceivedVariableIncome),
      targetSavings: Number(targetSavings),
      budgetedFixedBills: Number(budgetedFixedBills),
      paidFixedBills: Number(paidFixedBills),
      flexibleSpent: Number(flexibleSpent),
      daysRemainingInPeriod: Number(daysRemainingInPeriod),
    });

    res.json(summary);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Endpoint to compute period range for a given month_start_day
router.get("/period", (req, res) => {
  const monthStartDay = parseInt(req.query.monthStartDay as string) || 1;
  const dateStr = req.query.date as string;
  const refDate = dateStr ? new Date(dateStr) : new Date();

  const range = getPeriodRange(refDate, monthStartDay);
  res.json({
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    daysRemaining: range.daysRemaining,
  });
});

export default router;

