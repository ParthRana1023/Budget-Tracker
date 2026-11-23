import SiteHeader from "@/components/SiteHeader";
import DemoSplit from "@/components/DemoSplit";
import Reveal from "@/components/ui/Reveal";
import CountUp from "@/components/ui/CountUp";

/** Sign in / sign up / verify / forgot / reset: form on the left, demo panel on wide screens. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full overflow-x-clip">
      <SiteHeader />
      <div className="mx-auto flex min-h-[calc(100vh-65px)] max-w-[1200px] flex-wrap gap-3.5 px-6 py-6 max-[480px]:px-4">
        <main className="flex min-w-0 flex-[1_1_460px] items-center justify-center py-8">
          <div className="sf-rise flex w-full max-w-[400px] flex-col gap-6">{children}</div>
        </main>
        <aside className="flex flex-[1_1_460px] items-center justify-center rounded-3xl border border-line bg-tile p-12 max-[860px]:hidden">
          <Reveal immediate className="flex w-full max-w-[420px] flex-col gap-[22px]">
            <span className="eyebrow">What your dashboard opens with</span>
            <span className="tabular font-serif text-[96px] leading-[.86] tracking-[-0.025em]">
              <CountUp rupees={16800} />
            </span>
            <span className="font-serif text-[22px] text-pretty text-ink-2">
              That’s{" "}
              <em className="text-ink">
                <CountUp rupees={1120} /> a day
              </em>
              , after savings, bills and ₹12,900 already spent.
            </span>
            <DemoSplit />
            <p className="m-0 border-t border-line pt-[18px] text-[15px] text-pretty text-ink-2">
              Savings and bills come out first. Everything you spend comes from what’s left.
            </p>
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
