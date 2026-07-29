import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface HomeCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  count?: string;
  accentColor?: string;
}

export function HomeCard({
  title,
  description,
  icon: Icon,
  href,
  count,
  accentColor,
}: HomeCardProps) {
  return (
    <Link href={href} className="block group">
      <Card className="relative h-full overflow-hidden border-border/50 transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 p-6">
        {accentColor && (
          <div
            className="absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 rounded-full opacity-10"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <div className="flex flex-col gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: accentColor ? `${accentColor}18` : undefined,
            }}
          >
            <Icon
              className="w-5 h-5"
              style={{ color: accentColor ?? "var(--primary)" }}
            />
          </div>
          <div>
            <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
              {title}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          {count && (
            <p className="text-xs text-muted-foreground/70 mt-auto pt-2">
              {count}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}
