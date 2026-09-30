export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 text-muted [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="text-sm text-subtle">Last updated {updated}</p>
      </div>
      {children}
    </article>
  );
}

/** Shown as the contact address on legal pages. Set NEXT_PUBLIC_SUPPORT_EMAIL in Vercel. */
export const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";
