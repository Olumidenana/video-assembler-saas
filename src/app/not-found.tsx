import { HardLink } from "@/components/hard-link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <p className="font-mono text-sm text-brand">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">This page got cut in the edit.</h1>
      <p className="max-w-md text-muted">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <div className="flex gap-3">
        <HardLink href="/" className="btn btn-secondary">
          Home
        </HardLink>
        <HardLink href="/editor" className="btn btn-primary">
          Open the editor
        </HardLink>
      </div>
    </div>
  );
}
