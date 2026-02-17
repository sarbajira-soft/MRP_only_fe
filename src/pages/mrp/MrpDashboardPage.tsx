import { Link } from 'react-router-dom';
import { mrpRoutes } from '../../app/router/routes';

export default function MrpDashboardPage() {
  const cards = mrpRoutes.filter((r) => r.path !== '/mrp');

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-700 p-6 text-white shadow-sm">
        <div className="text-2xl font-semibold">Dashboard</div>
        <div className="mt-1 text-sm text-white/80">Select a module to continue.</div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.path}
            to={c.path}
            className="group rounded-2xl border border-slate-200/60 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900 group-hover:underline">
                {c.label}
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">Go to {c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
