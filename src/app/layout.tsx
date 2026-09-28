import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { HardLink } from "@/components/hard-link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anti-Timeout Video Splitter & Assembler",
  description:
    "Trim, split and stitch videos right in your browser. No uploads, no server timeouts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-foreground/10">
          <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 text-sm">
            <HardLink href="/" className="font-semibold">
              Anti-Timeout
            </HardLink>
            <div className="flex gap-4">
              <HardLink href="/editor">Editor</HardLink>
              <HardLink href="/pricing">Pricing</HardLink>
              <HardLink href="/login">Log in</HardLink>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
