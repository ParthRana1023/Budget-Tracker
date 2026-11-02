import Link from "next/link";
import { ArrowRight, ShieldCheck, Wallet, PiggyBank, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Navigation */}
      <header className="px-6 py-4 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-500/20">
            <PiggyBank className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg text-slate-900 tracking-tight">SaveFirst</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm transition-colors"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Savings-First Personal Budgeting</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
          Know exactly what is <br className="hidden sm:inline" />
          <span className="text-emerald-600">safe to spend</span> every single day.
        </h1>

        <p className="text-lg sm:text-xl text-slate-600 mb-8 max-w-2xl">
          Set aside savings and fixed bills before looking at your spendable money. 
          No guilt, no surprise end-of-month shortages, and fast 3-tap expense logging.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto mb-16">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-base font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-600/25 transition-all transform hover:-translate-y-0.5"
          >
            Create Your Free Account
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-3.5 text-base font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
          >
            Log In
          </Link>
        </div>

        {/* Value Prop Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left w-full mt-4">
          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 mb-1">Savings First</h3>
            <p className="text-sm text-slate-600">
              Savings goals and fixed commitments come out immediately so you never overcommit.
            </p>
          </div>

          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-4">
              <Wallet className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 mb-1">Variable Pay Isolated</h3>
            <p className="text-sm text-slate-600">
              Bonuses and performance incentives stay in an expected holding bucket until deposited.
            </p>
          </div>

          <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center mb-4">
              <PiggyBank className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 mb-1">3-Tap Fast Logging</h3>
            <p className="text-sm text-slate-600">
              Log any coffee or grocery run in 3 quick taps on your phone before you walk away.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-slate-200 text-center text-xs text-slate-500">
        Personal Budget Tracker • Built with Next.js 16.4.4 & Supabase
      </footer>
    </div>
  );
}

