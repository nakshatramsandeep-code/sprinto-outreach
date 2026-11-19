"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, prefetch, PAGE_DATA } from "@/lib/client";

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

  // The badge needs ONE number, so it asks the tiny /api/badge endpoint (it used to load the whole dashboard on every page).
  useEffect(() => {
    const refresh = () => api<{ needsYou: number }>("/api/badge").then((r) => setOpen(r.needsYou)).catch(() => {});
    refresh();
    // pages announce "checkpoints-changed" after an action; the timer is a backstop for changes made elsewhere
    window.addEventListener("checkpoints-changed", refresh);
    const t = setInterval(refresh, 30_000);
    return () => { window.removeEventListener("checkpoints-changed", refresh); clearInterval(t); };
  }, [path]);

  // Quietly warm the other pages' data a moment after load, so clicking a nav link shows data immediately.
  useEffect(() => {
    const others = LINKS.map((l) => PAGE_DATA[l.href]).filter((p) => p && p !== PAGE_DATA[path]);
    const timers = others.map((p, i) => setTimeout(() => prefetch(p, 60_000), 1500 + i * 350));
    return () => timers.forEach(clearTimeout);
  }, [path]);

  return (
    <div className="topbar">
      <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>Outreach <span>Copilot</span></Link>
      <nav className="nav" aria-label="Main">
        {LINKS.map((l) => {
          const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={on ? "active" : ""} onMouseEnter={() => PAGE_DATA[l.href] && prefetch(PAGE_DATA[l.href])} onFocus={() => PAGE_DATA[l.href] && prefetch(PAGE_DATA[l.href])}>
              {l.label}{l.badge && open ? <span className="count">{open}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
