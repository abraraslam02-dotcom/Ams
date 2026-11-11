import React, { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  badge?: ReactNode;
  colorTheme?: 'emerald' | 'blue' | 'purple' | 'amber' | 'slate';
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  badge,
  colorTheme = 'emerald',
}) => {
  const getThemeStyles = () => {
    switch (colorTheme) {
      case 'emerald':
        return {
          bg: 'bg-emerald-50/50',
          iconBg: 'bg-emerald-100 text-emerald-700',
          border: 'border-emerald-100',
        };
      case 'blue':
        return {
          bg: 'bg-blue-50/50',
          iconBg: 'bg-blue-100 text-blue-700',
          border: 'border-blue-100',
        };
      case 'purple':
        return {
          bg: 'bg-purple-50/50',
          iconBg: 'bg-purple-100 text-purple-700',
          border: 'border-purple-100',
        };
      case 'amber':
        return {
          bg: 'bg-amber-50/50',
          iconBg: 'bg-amber-100 text-amber-700',
          border: 'border-amber-100',
        };
      case 'slate':
      default:
        return {
          bg: 'bg-slate-50/50',
          iconBg: 'bg-slate-100 text-slate-700',
          border: 'border-slate-100',
        };
    }
  };

  const theme = getThemeStyles();

  return (
    <div className={`p-4 rounded-xl border bg-white shadow-xs hover:shadow-md transition-shadow duration-200 ${theme.border}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </span>
        <div className={`p-2 rounded-lg ${theme.iconBg}`}>
          {icon}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-2xl font-bold tracking-tight text-slate-900 truncate">
          {value}
        </div>
        {badge && <div>{badge}</div>}
      </div>
      {subtitle && (
        <p className="mt-1.5 text-xs text-slate-500 font-medium">
          {subtitle}
        </p>
      )}
    </div>
  );
};
