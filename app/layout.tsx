import "./globals.css";
import type { ReactNode } from "react";
import { Instrument_Sans } from "next/font/google";
import Nav from "@/components/Nav";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = { title: "Outreach Copilot", description: "Finds ICP-fit companies, drafts personalised cold emails, a human sends." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <Nav />
        {children}
        <div className="footer">Demo mode: every email goes to the owner inbox only. Styled after sprinto.com; not an official Sprinto product.</div>
      </body>
    </html>
  );
}
