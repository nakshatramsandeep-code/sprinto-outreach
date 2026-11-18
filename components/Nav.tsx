"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/review", label: "Review queue", badge: true },
  { href: "/outreach", label: "Outreach" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/discover", label: "Discover" },
  { href: "/accounts", label: "Accounts" },
  { href: "/analytics", label: "Analytics" },
  { href: "/evals", label: "Evals" },
  { href: "/learning", label: "Learning" },
  { href: "/rules", label: "ICP & Rules" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    api<{ kpis: { needsYou: number } }>("/api/home").then((r) => setOpen(r.kpis.needsYou)).catch(() => {});
  }, [path]);
  return (
    <div className="topbar">
      <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>Outreach <span>Copilot</span></Link>
      <nav className="nav" aria-label="Main">
        {LINKS.map((l) => {
          const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={on ? "active" : ""}>
              {l.label}{l.badge && open ? <span className="count">{open}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
