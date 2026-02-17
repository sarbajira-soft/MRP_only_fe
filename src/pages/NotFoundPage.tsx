import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-700 p-5 text-white">
          <div className="text-2xl font-semibold">Page not found</div>
          <div className="mt-1 text-sm text-white/80">The page you are looking for doesn&apos;t exist.</div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-slate-600">Return to the dashboard to continue.</div>
          <Link
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            to="/mrp"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
