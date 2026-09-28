import type { Metadata } from "next";

export const metadata: Metadata = { title: "Log in · Anti-Timeout" };

export default function LoginPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Log in</h1>
      {/* Stage 3: Supabase magic-link sign-in. */}
    </section>
  );
}
