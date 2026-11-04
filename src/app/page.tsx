import type { Metadata } from "next";
import { LandingPage } from "@/components/public-site";
export const metadata: Metadata = { title: "Folio — Make room for better work", alternates: { canonical: "/" }, description: "Your projects, plans, and bright ideas. Beautifully together. A thoughtful personal workspace for everything you want to make happen." };
export default function HomePage() {
  const schema = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Folio", applicationCategory: "ProductivityApplication", operatingSystem: "Web browser", description: "A personal workspace for projects, tasks, ideas, and schedules.", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}/><LandingPage/></>;
}
