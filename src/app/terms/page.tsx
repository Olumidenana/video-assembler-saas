import type { Metadata } from "next";
import { LegalPage, supportEmail } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of Service · Anti-Timeout" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="30 September 2026">
      <p>By using Anti-Timeout, you agree to these terms. If you don&apos;t agree, please don&apos;t use the service.</p>

      <h2>The service</h2>
      <p>
        Anti-Timeout lets you trim, split and join videos in your browser. Processing uses your device&apos;s resources,
        so speed and the size of videos you can handle depend on your device and browser.
      </p>

      <h2>Your content</h2>
      <p>
        You keep all rights to your videos. Because they are processed on your device, you are responsible for keeping
        copies of your files and for having the right to edit and share the content you use.
      </p>

      <h2>Free and Pro plans</h2>
      <ul>
        <li>The Free plan has limits, such as the number of clips per stitch and the export resolution.</li>
        <li>
          Pro is a subscription billed in advance through Paystack at the price shown on the Pricing page. It renews
          automatically each billing period until you cancel.
        </li>
        <li>
          You can cancel at any time from your Account page. Pro stays active until the end of the period you have paid
          for. Payments already made are not refunded, except where the law requires it.
        </li>
        <li>We may change prices with advance notice. Changes apply from your next billing period.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Don&apos;t use Anti-Timeout for anything unlawful, or try to disrupt, reverse-engineer or abuse the service.</p>

      <h2>No warranty</h2>
      <p>
        The service is provided &quot;as is&quot;. We work hard to keep it reliable, but we can&apos;t guarantee it will
        always be available or error-free. To the extent the law allows, we are not liable for indirect losses or lost
        data.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. If we make significant changes, we&apos;ll update the date above.</p>

      <h2>Contact</h2>
      <p>
        {supportEmail ? <>Email us at <a className="text-brand hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : "Contact us through the support email shown on the Google sign-in screen."}
      </p>
    </LegalPage>
  );
}
