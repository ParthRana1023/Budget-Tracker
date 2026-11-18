"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { HomeLogo } from "./StatusPage";

/** Sticky header for the landing and sign-in pages (design handoff, Landing and Auth). */
export default function SiteHeader({ nav = false }: { nav?: boolean }) {
  const path = usePathname();
  const hideSignIn = path === "/login" || path === "/verify";
  const hideGetStarted = path === "/signup";

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-4 px-6 max-[480px]:px-4">
        <HomeLogo />
        {nav && (
          <nav className="flex gap-0.5 rounded-full border border-line p-[3px] text-[13px] font-medium max-[820px]:hidden">
            {[
              ["#how", "How it works"],
              ["#features", "Features"],
              ["#faq", "FAQ"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="flex h-[30px] items-center rounded-full px-3.5 text-ink-2 transition-colors duration-200 hover:bg-tile-2 hover:text-ink"
              >
                {label}
              </a>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {!hideSignIn && (
            <Link
              href="/login"
              className="flex h-[38px] items-center rounded-full border border-line px-[15px] text-[13px] font-semibold text-ink transition-colors hover:border-ink-2 hover:text-ink max-[480px]:hidden"
            >
              Sign in
            </Link>
          )}
          {!hideGetStarted && (
            <Link
              href="/signup"
              className="flex h-[38px] items-center rounded-full bg-lime px-4 text-[13px] font-bold text-lime-ink transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:text-lime-ink hover:shadow-[0_8px_24px_-10px_var(--lime)] active:scale-[.96]"
            >
              Get started
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
