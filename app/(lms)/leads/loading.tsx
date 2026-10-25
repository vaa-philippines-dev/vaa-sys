function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} />
}

export default function LeadsLoading() {
  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6" aria-busy="true">
      <div className="grid grid-cols-1 items-center gap-6 rounded-2xl border bg-card px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Block className="h-3.5 w-28" />
          <Block className="h-[92px] w-full" />
        </div>
        <Block className="h-[104px] w-[140px] justify-self-center rounded-full" />
        <div className="flex flex-col items-center gap-2">
          <Block className="h-6 w-10" />
          <Block className="h-3 w-24" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Block className="h-6 w-10" />
          <Block className="h-3 w-28" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Block className="h-9 w-9" />
        <div className="flex flex-col gap-2">
          <Block className="h-6 w-24" />
          <Block className="h-3.5 w-48" />
        </div>
      </div>
      <div className="no-scrollbar flex gap-6 overflow-x-auto pb-2">
        {Array.from({ length: 5 }, (_, col) => (
          <div key={col} className="flex w-[268px] shrink-0 flex-col gap-3">
            <Block className="h-4 w-24" />
            <Block className="h-24 w-full" />
            {col < 3 && <Block className="h-24 w-full" />}
          </div>
        ))}
      </div>
    </main>
  )
}
