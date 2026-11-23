import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import PwaRegister from "@/components/PwaRegister";
import ErrorReporter from "@/components/ErrorReporter";
import { ToastProvider } from "@/components/ui/Toast";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Fonts ship with the app (./fonts, SIL OFL), so no request goes to Google at build or run time.
const hanken = localFont({
  src: "./fonts/HankenGrotesk-VF.woff2",
  weight: "100 900",
  variable: "--font-hanken",
  display: "swap",
});
const instrument = localFont({
  src: [
    { path: "./fonts/InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "SaveFirst - Personal Budget Tracker",
  description: "Savings-first budgeting web app with live Safe-to-Spend tracking",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: { capable: true, title: "SaveFirst", statusBarStyle: "black-translucent" },
};

// viewport-fit=cover lets the installed app draw under the notch; layouts pad with
// env(safe-area-inset-*). Pinch-zoom stays allowed (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b0c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" className={`${hanken.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased flex flex-col">
        <ErrorReporter />
        <ToastProvider>
          <PwaRegister />
          {children}
        </ToastProvider>
        {/* Their scripts live at /_vercel/*, which only exists on Vercel. */}
        {process.env.VERCEL && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
