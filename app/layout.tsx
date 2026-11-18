import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { Instrument_Sans } from "next/font/google";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = { title: "Outreach Copilot", description: "Finds ICP-fit companies, drafts personalised cold emails, a human sends." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <div className="topbar">
          <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>Outreach <span>Copilot</span></Link>
          <span className="small" style={{ color: "#f0dbe6" }}>Demo · emails go to your inbox only</span>
        </div>
        {children}
        <div className="footer">Internal demo built for a case study. Styled after sprinto.com; not an official Sprinto product.</div>
      </body>
    </html>
  );
}
