import { Fragment } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export interface PageBreadcrumbItem {
  label: string;
  href?: string;
}

interface PageBreadcrumbProps {
  items: PageBreadcrumbItem[];
  className?: string;
}

export function PageBreadcrumb({ items, className }: PageBreadcrumbProps) {
  if (!items.length) return null;
  const lastIndex = items.length - 1;
  const truncatedIndex = items.length > 2 ? 1 : -1;

  return (
    <nav
      aria-label="breadcrumb"
      className={cn(
        "flex items-center gap-2 text-base font-light text-muted-foreground/80 lowercase min-w-0",
        className,
      )}
    >
      {items.map((item, index) => {
        const isLast = index === lastIndex;
        const isTruncatable = index === truncatedIndex;
        const labelClass = cn(
          "truncate transition-colors",
          isLast ? "text-foreground/80 font-normal" : "hover:text-foreground",
          isTruncatable && "hidden sm:inline",
        );
        const ellipsis = isTruncatable ? (
          <span className="inline sm:hidden text-muted-foreground/60" aria-hidden="true">…</span>
        ) : null;

        return (
          <Fragment key={`${index}-${item.label}`}>
            {index > 0 && (
              <span className="text-muted-foreground/40 select-none" aria-hidden="true">/</span>
            )}
            {item.href && !isLast ? (
              <Link href={item.href}>
                <span className={cn(labelClass, "cursor-pointer max-w-[12rem]")}>{item.label}</span>
              </Link>
            ) : (
              <span
                className={cn(labelClass, "max-w-[16rem]")}
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </span>
            )}
            {ellipsis}
          </Fragment>
        );
      })}
    </nav>
  );
}
