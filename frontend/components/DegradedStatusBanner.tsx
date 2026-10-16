interface DegradedStatusBannerProps {
  title: string;
  message: string;
}

export default function DegradedStatusBanner({
  title,
  message,
}: DegradedStatusBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4"
    >
      <p className="font-medium text-amber-300">{title}</p>
      <p className="mt-1 text-sm text-amber-200">{message}</p>
    </div>
  );
}
