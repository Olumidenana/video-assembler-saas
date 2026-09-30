import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { RevealObserver } from "@/components/reveal";
import { SiteHeader } from "@/components/site-header";
import { publicEnv } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "AI video editor in your browser: finds the best moments, removes silences, and splits or stitches videos. No uploads, no timeouts.";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "Anti-Timeout · AI video splitter & stitcher", template: "%s" },
  description,
  openGraph: { type: "website", siteName: "Anti-Timeout", title: "Anti-Timeout · AI cuts the best parts", description },
  twitter: { card: "summary_large_image", title: "Anti-Timeout · AI cuts the best parts", description },
};

export const viewport = { themeColor: "#0a0a0d" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available before paint, so scroll-reveal content never flashes or stays hidden. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="flex min-h-full flex-col">
        <RevealObserver />
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
