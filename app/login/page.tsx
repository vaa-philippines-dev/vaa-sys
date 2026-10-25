import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; error_description?: string }>
}) {
  const { next, error, error_description } = await searchParams
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div
          className="absolute rounded-full blur-3xl"
          style={{
            width: 480,
            height: 480,
            background: 'radial-gradient(circle, rgba(128,128,128,0.16) 0%, transparent 70%)',
          }}
        />
      </div>

      <LoginForm
        className="animate-in fade-in-0 zoom-in-95 duration-300"
        next={next}
        errorCode={error}
        errorDescription={error_description}
      />
    </div>
  )
}
