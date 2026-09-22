import type { ReactNode } from 'react';

export function AdminPageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return <header className="admin-page-header">
    <div className="min-w-0"><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}
