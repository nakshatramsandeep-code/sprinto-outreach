import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Sprinto Outreach Copilot", description: "Finds ICP-fit companies, drafts personalised cold emails, a human sends." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
