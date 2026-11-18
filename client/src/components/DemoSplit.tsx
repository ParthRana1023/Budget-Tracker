// Sample numbers from the design handoff's demo account (marketing only, never real data).

/** Coloured dot + label + bold amount, used under split bars. */
export function Legend({ items }: { items: Array<[color: string, label: string, amount: string]> }) {
  return (
    <div className="tabular flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
      {items.map(([color, label, amount]) => (
        <span key={label} className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />
          {label} <strong className="font-semibold text-ink">{amount}</strong>
        </span>
      ))}
    </div>
  );
}

/** Savings / bills / spent / safe bar for the demo account. Put inside <Reveal> so it fills in. */
export default function DemoSplit() {
  const parts: Array<[string, string]> = [
    ["31.58%", "var(--lime)"],
    ["37.16%", "var(--fixed)"],
    ["13.58%", "var(--flex)"],
    ["17.68%", "var(--ink)"],
  ];
  return (
    <>
      <div aria-hidden className="flex h-3 gap-[3px]">
        {parts.map(([w, c], i) => (
          <div key={c} className="rv-bar rounded-md" style={{ width: w, background: c, transitionDelay: `${0.25 + i * 0.15}s` }} />
        ))}
      </div>
      <Legend
        items={[
          ["var(--lime)", "Savings", "₹30,000"],
          ["var(--fixed)", "Bills", "₹35,300"],
          ["var(--flex)", "Spent", "₹12,900"],
          ["var(--ink)", "Safe", "₹16,800"],
        ]}
      />
    </>
  );
}
