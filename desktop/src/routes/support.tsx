import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SupportHub from "../components/support/SupportHub";
import GettingStartedSection from "../components/support/GettingStartedSection";
import FAQSection from "../components/support/FAQSection";
import TroubleshootingSection from "../components/support/TroubleshootingSection";
import FeatureGuidesSection from "../components/support/FeatureGuidesSection";
import BillingHelpSection from "../components/support/BillingHelpSection";
import ContactForm from "../components/support/ContactForm";
import type { SectionId } from "../components/support/SupportHub";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";

export const Route = createFileRoute("/support")({
  component: SupportPage,
  errorComponent: RouteError,
});

const SECTION_TITLES: Record<SectionId, string> = {
  "getting-started": "Getting Started",
  faq: "Frequently Asked Questions",
  troubleshooting: "Troubleshooting",
  guides: "Feature Guides",
  billing: "Account & Billing",
  contact: "Contact Us",
};

function SupportPage() {
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);

  // Hub view — search + category cards.
  if (!activeSection) {
    return (
      <PageLayout
        title="Support"
        subtitle="Find help, file bugs, or contact us"
        width="wide"
      >
        <SupportHub onSelectSection={setActiveSection} />
      </PageLayout>
    );
  }

  // Section view — TopBar shows "Support / <section>" breadcrumb.
  // Click "Support" in the breadcrumb to return to the hub.
  return (
    <PageLayout
      title={SECTION_TITLES[activeSection]}
      subtitle={
        activeSection === "contact"
          ? "Report bugs, request features, or send feedback"
          : "Get help, find answers, and contact us"
      }
      parentLabel="Support"
      onParentClick={() => setActiveSection(null)}
      width="wide"
    >
      {activeSection === "getting-started" && <GettingStartedSection />}
      {activeSection === "faq" && <FAQSection />}
      {activeSection === "troubleshooting" && <TroubleshootingSection />}
      {activeSection === "guides" && <FeatureGuidesSection />}
      {activeSection === "billing" && <BillingHelpSection />}
      {activeSection === "contact" && (
        <ContactForm onBack={() => setActiveSection(null)} />
      )}
    </PageLayout>
  );
}
