function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className ?? ''}`} />
}

export default function CustomerLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
      <Block className="h-4 w-24" />
      <Block className="h-44 w-full rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Block className="h-72 w-full rounded-2xl" />
        <Block className="h-72 w-full rounded-2xl" />
      </div>
    </main>
  )
}
