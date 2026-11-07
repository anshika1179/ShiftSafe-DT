import Link from "next/link";
export default function NotFound() {
  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center text-center px-4">
      <div className="text-6xl mb-4">🔍</div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Page Not Found</h1>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        This page doesn&apos;t exist. If you&apos;re looking for your dashboard, 
        make sure you&apos;re registered first.
      </p>
      <div className="flex gap-3">
        <Link
          href="/"
          className="btn btn-primary px-6 py-3 rounded-xl text-sm font-bold"
        >
          Go Home
        </Link>
        <Link
          href="/register"
          className="btn px-6 py-3 rounded-xl text-sm font-bold border border-gray-200 text-gray-700 hover:bg-gray-50"
        >
          Register
        </Link>
      </div>
    </div>
  );
}
