import type { Metadata } from "next";
import { LegalPage, supportEmail } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy · Anti-Timeout" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="30 September 2026">
      <p>
        Anti-Timeout is a video editor that runs in your web browser. This policy explains what information we handle and
        why.
      </p>

      <h2>Your videos</h2>
      <p>
        <strong>Your videos never leave your device.</strong> Trimming, splitting and stitching happen entirely inside your
        browser. We do not upload, store, view or analyse your video files.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> if you sign in with Google, we receive your name and email address from
          Google. We use them to identify your account and your subscription.
        </li>
        <li>
          <strong>Subscription details:</strong> if you subscribe to Pro, payments are processed by Paystack. We store your
          subscription status, renewal date and Paystack customer reference. We never see or store your card details.
        </li>
        <li>
          <strong>Technical data:</strong> our hosting provider (Vercel) and authentication provider (Supabase) keep
          standard server logs, such as IP addresses and request times, for security and reliability.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>We use essential cookies only, to keep you signed in. We do not use advertising or tracking cookies.</p>

      <h2>How we share information</h2>
      <p>
        We do not sell your information. We share it only with the services that run Anti-Timeout: Supabase
        (authentication and database), Paystack (payments), Vercel (hosting) and Google (sign-in), and where the law
        requires it.
      </p>

      <h2>Your choices</h2>
      <p>
        You can use the editor without an account. You can cancel your subscription at any time from your Account page,
        and you can ask us to delete your account and associated data by contacting us.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? {supportEmail ? <>Email us at <a className="text-brand hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : "Contact us through the support email shown on the Google sign-in screen."}
      </p>
    </LegalPage>
  );
}
