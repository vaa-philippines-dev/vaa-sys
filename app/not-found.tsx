import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-lg font-semibold">Not found</p>
      <p className="text-sm text-muted-foreground">That page or customer doesn&apos;t exist.</p>
      <Link href="/" className="mt-2 text-sm text-primary hover:underline">
        Back to VAA Systems
      </Link>
    </div>
  )
}
