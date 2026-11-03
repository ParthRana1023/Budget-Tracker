"use client";

import { useState } from "react";
import { BudgetAlert } from "@/lib/alertUtils";
import { 
  AlertTriangle, 
  ShieldAlert, 
  X, 
  ChevronDown, 
  ChevronUp, 
  Flame,
  CheckCircle2
} from "lucide-react";

interface AlertBannerProps {
  alerts: BudgetAlert[];
}

export default function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const activeAlerts = alerts.filter((a) => !dismissedIds.includes(a.id));

  if (activeAlerts.length === 0) return null;

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => [...prev, id]);
  };

  // Check if any alert is critical / danger
  const hasCritical = activeAlerts.some((a) => a.severity === "critical" || a.severity === "danger");

  return (
    <div
      className={`rounded-3xl border transition-all overflow-hidden ${
        hasCritical
          ? "bg-rose-50/90 border-rose-200 shadow-sm shadow-rose-900/5"
          : "bg-amber-50/90 border-amber-200 shadow-sm shadow-amber-900/5"
      }`}
    >
      {/* Banner Top Header */}
      <div className="p-4 px-5 flex items-center justify-between border-b border-black/5">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              hasCritical ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
            }`}
          >
            {hasCritical ? <ShieldAlert className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          </div>
          <div>
            <h4
              className={`font-bold text-sm leading-tight ${
                hasCritical ? "text-rose-950" : "text-amber-950"
              }`}
            >
              Budget & Limit Warnings
            </h4>
            <p className="text-[11px] text-slate-600">
              {activeAlerts.length} {activeAlerts.length === 1 ? "alert requires" : "alerts require"} your attention
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-black/5 transition-colors"
            title={isExpanded ? "Collapse alerts" : "Expand alerts"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Alerts List */}
      {isExpanded && (
        <div className="p-4 px-5 space-y-2.5">
          {activeAlerts.map((alert) => {
            const isCritical = alert.severity === "critical" || alert.severity === "danger";

            return (
              <div
                key={alert.id}
                className={`p-3 rounded-2xl border flex items-start justify-between gap-3 text-xs transition-all ${
                  isCritical
                    ? "bg-white border-rose-200/80 text-rose-900 shadow-xs"
                    : "bg-white border-amber-200/80 text-amber-900 shadow-xs"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      isCritical ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {alert.type === "savings_threat" ? (
                      <Flame className="w-3.5 h-3.5 text-rose-600" />
                    ) : alert.type === "category_100" ? (
                      <ShieldAlert className="w-3.5 h-3.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 block">{alert.title}</span>
                    <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                      {alert.message}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDismiss(alert.id)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
                  title="Dismiss warning"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

