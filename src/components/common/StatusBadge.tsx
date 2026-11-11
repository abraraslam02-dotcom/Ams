import React from 'react';

interface StatusBadgeProps {
  status: 'healthy' | 'connected' | 'ready' | 'pending' | 'warning' | 'error' | 'locked';
  label?: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, size = 'md' }) => {
  const getStyles = () => {
    switch (status) {
      case 'healthy':
      case 'connected':
      case 'ready':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-600/20';
      case 'pending':
        return 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-600/20';
      case 'locked':
        return 'bg-slate-100 text-slate-600 border-slate-200 ring-slate-500/20';
      case 'warning':
        return 'bg-orange-50 text-orange-700 border-orange-200 ring-orange-600/20';
      case 'error':
        return 'bg-rose-50 text-rose-700 border-rose-200 ring-rose-600/20';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200 ring-slate-600/20';
    }
  };

  const getDotColor = () => {
    switch (status) {
      case 'healthy':
      case 'connected':
      case 'ready':
        return 'bg-emerald-500';
      case 'pending':
        return 'bg-amber-500';
      case 'locked':
        return 'bg-slate-400';
      case 'warning':
        return 'bg-orange-500';
      case 'error':
        return 'bg-rose-500';
      default:
        return 'bg-slate-500';
    }
  };

  const defaultText = {
    healthy: 'Healthy',
    connected: 'Connected',
    ready: 'Ready',
    pending: 'Awaiting Task 2',
    locked: 'Task 2 Module',
    warning: 'Warning',
    error: 'Disconnected',
  }[status];

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border ring-1 ring-inset ${getStyles()} ${sizeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${getDotColor()} ${status === 'connected' || status === 'healthy' ? 'animate-pulse' : ''}`} />
      {label || defaultText}
    </span>
  );
};
