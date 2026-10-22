"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

/** Nav links that mark the current section. Needs a Suspense boundary: stock pages have a request-time param. */
export default function NavLinks() {
  const path = usePathname();
  return <>{NAV.map(([href, label]) => {
    const here = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
    return <Link key={href} href={href} aria-current={here ? "page" : undefined}>{label}</Link>;
  })}</>;
}
