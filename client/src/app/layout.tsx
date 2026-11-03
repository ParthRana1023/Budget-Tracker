import type { Metadata } from "next";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Budget Tracker",
  description: "Savings-first budgeting web app with live Safe-to-Spend tracking",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}

