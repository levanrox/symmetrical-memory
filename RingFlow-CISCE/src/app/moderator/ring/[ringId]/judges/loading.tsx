export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 lg:max-w-4xl">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-container" />
      ))}
    </div>
  );
}
