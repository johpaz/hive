interface ConfigInsightCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  theme: "blue" | "cyan" | "purple";
}

const themeStyles = {
  blue: {
    bg: "bg-blue-500/5",
    border: "border-blue-500/15",
    borderHover: "hover:border-blue-500/25",
    iconBg: "bg-blue-500/10",
    iconBorder: "border-blue-500/20",
    iconColor: "text-blue-400",
  },
  purple: {
    bg: "bg-purple-500/5",
    border: "border-purple-500/15",
    borderHover: "hover:border-purple-500/25",
    iconBg: "bg-purple-500/10",
    iconBorder: "border-purple-500/20",
    iconColor: "text-purple-400",
  },
  cyan: {
    bg: "bg-cyan-500/5",
    border: "border-cyan-500/15",
    borderHover: "hover:border-cyan-500/25",
    iconBg: "bg-cyan-500/10",
    iconBorder: "border-cyan-500/20",
    iconColor: "text-cyan-400",
  },
};

export function ConfigInsightCard({ icon: Icon, title, description, theme }: ConfigInsightCardProps) {
  const styles = themeStyles[theme];

  return (
    <div
      className={`rounded-xl border p-5 space-y-3 transition-all duration-300 hover:scale-[1.02] ${styles.bg} ${styles.border} ${styles.borderHover}`}
    >
      <div className="flex items-center gap-2.5">
        <div className={`p-2 rounded-lg border ${styles.iconBg} ${styles.iconBorder}`}>
          <Icon className={`h-4 w-4 ${styles.iconColor}`} />
        </div>
        <p className="text-xs font-bold" style={{ color: "hsl(var(--hive-foreground) / 0.8)" }}>{title}</p>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "hsl(var(--hive-muted-foreground))" }}>
        {description}
      </p>
    </div>
  );
}
