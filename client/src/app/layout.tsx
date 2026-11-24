import type { Metadata, Viewport } from "next";

/** iPhone screens with launch images in public/splash: CSS width, height, pixel ratio. */
const SPLASH: Array<[number, number, number]> = [
  [440, 956, 3],
  [402, 874, 3],
  [420, 912, 3],
  [360, 780, 3],
  [430, 932, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 2],
  [375, 667, 2],
];
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
  appleWebApp: {
    capable: true,
    title: "SaveFirst",
    statusBarStyle: "black-translucent",
    // iOS launch images (design handoff v3, PWA 2l), one per screen size, dark and light.
    startupImage: SPLASH.flatMap(([w, h, dpr]) =>
      (["dark", "light"] as const).map((scheme) => ({
        url: `/splash/${scheme}-${w * dpr}x${h * dpr}.png`,
        media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`,
      })),
    ),
  },
};

// viewport-fit=cover lets the installed app draw under the notch; layouts pad with
// env(safe-area-inset-*). Pinch-zoom stays allowed (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
    { media: "(prefers-color-scheme: light)", color: "#ecece6" },
  ],
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
