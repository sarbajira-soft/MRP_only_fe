import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { mrpRoutes } from '../router/routes';
import { clearAuthUser, getAuthUser } from '../auth/session';

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = mrpRoutes.find((r) => r.path === location.pathname);
  const user = getAuthUser();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <aside className="w-72 border-r border-slate-200/70 bg-white">
          <div className="p-5">
            <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-700 p-4 text-white shadow-sm">
              <div className="text-base font-semibold tracking-wide">MRP</div>
              <div className="mt-0.5 text-xs text-white/80">Material Requirements Planning</div>
            </div>
          </div>

          <nav className="px-3 pb-5">
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Navigation</div>
            <div className="space-y-1">
              <NavLink
                to="/mrp"
                end
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition',
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')
                }
              >
                <span>{mrpRoutes.find((r) => r.path === '/mrp')?.label ?? 'Dashboard'}</span>
              </NavLink>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">MRP</div>
                <div className="text-base font-semibold text-slate-900">{current?.label ?? 'Dashboard'}</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 md:block">
                  {new Date().toLocaleDateString()}
                </div>
                <div className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:block">
                  {user?.displayName || user?.username || 'User'}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthUser();
                    navigate('/login', { replace: true });
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Logout
                </button>
                <div className="h-9 w-9 rounded-full bg-indigo-600/10 ring-1 ring-indigo-600/20" />
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
