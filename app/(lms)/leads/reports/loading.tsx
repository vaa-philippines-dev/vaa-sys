function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} />
}

// Its own skeleton, so the board's (leads/loading.tsx) isn't shown here.
export default function LeadReportsLoading() {
  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Block className="h-3 w-28" />
        <Block className="h-7 w-40" />
        <Block className="h-3.5 w-56" />
      </div>
      <Block className="h-8 w-full max-w-xl" />
      {[220, 260, 220].map((h, i) => (
        <div key={i} className="rounded-2xl border bg-card px-6 py-5">
          <Block className="h-4 w-36" />
          <Block className="mt-4 w-full" />
          <div style={{ height: h }} className="mt-4 animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </main>
  )
}
