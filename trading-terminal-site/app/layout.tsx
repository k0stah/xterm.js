import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aster Forex Simulator",
  description: "An ECB-anchored simulated forex trading terminal.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
