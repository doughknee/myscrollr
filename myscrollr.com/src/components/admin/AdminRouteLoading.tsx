/** Immediate feedback while a staff page's JavaScript loads. */
export function AdminRouteLoading({ page }: { page: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-5 py-8 sm:px-8">
      <p role="status" className="text-sm text-base-content/60">
        Opening {page}…
      </p>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <div className="h-8 w-44 rounded-lg bg-base-200" />
        <div className="h-10 max-w-xl rounded-lg bg-base-200/60" />
        <div className="h-64 rounded-2xl border border-hairline bg-base-150" />
      </div>
    </div>
  )
}
