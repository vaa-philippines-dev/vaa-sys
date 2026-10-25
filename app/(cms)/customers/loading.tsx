function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} />
}

export default function CustomersLoading() {
  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-4 py-6 sm:px-6" aria-busy="true">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Block className="h-3 w-36" />
          <Block className="h-7 w-40" />
        </div>
        <Block className="h-9 w-64 rounded-xl" />
      </div>
      <Block className="h-36 w-full rounded-2xl" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Block className="h-80 w-full rounded-2xl" />
        <Block className="h-80 w-full rounded-2xl" />
      </div>
    </main>
  )
}
