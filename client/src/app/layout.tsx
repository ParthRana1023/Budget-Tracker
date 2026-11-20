import type { Metadata } from "next";
import localFont from "next/font/local";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" className={`${hanken.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased flex flex-col">
        <PwaRegister />
        <ErrorReporter />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
