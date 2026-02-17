import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { loginApi } from '../app/auth/authApi';
import { isAuthenticated, setAuthUser } from '../app/auth/session';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const fromPath = useMemo(() => {
    const st = location.state as { from?: string } | null;
    return st?.from || '/mrp';
  }, [location.state]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/mrp', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const u = username.trim();
    if (!u || !password) {
      await Swal.fire({ icon: 'warning', title: 'Missing details', text: 'Enter email/username and password.' });
      return;
    }

    setSubmitting(true);
    try {
      const user = await loginApi({ username: u, password });
      setAuthUser(user);
      navigate(fromPath, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      await Swal.fire({ icon: 'error', title: 'Login failed', text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-md items-center">
        <div className="w-full rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-700 p-5 text-white">
            <div className="text-2xl font-semibold">MRP Login</div>
            <div className="mt-1 text-sm text-white/80">Sign in to continue</div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter email or username"
                autoComplete="username"
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
