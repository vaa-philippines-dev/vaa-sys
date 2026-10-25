function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} />
}

export default function LeadLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
      <Block className="h-4 w-16" />
      <div className="flex items-start gap-4 rounded-2xl border bg-card p-5">
        <Block className="h-14 w-14 rounded-full" />
        <div className="flex flex-col gap-2">
          <Block className="h-6 w-48" />
          <Block className="h-3.5 w-32" />
        </div>
      </div>
      <Block className="h-40 w-full rounded-2xl" />
      <Block className="h-56 w-full rounded-2xl" />
    </main>
  )
}
