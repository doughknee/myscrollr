/**
 * Support route — landing hub + section views.
 *
 * - Hub view: search + category cards. No tab band; the cards ARE the
 *   navigation.
 * - Section view: in-page tab band of sibling sections at the top so
 *   users can hop between Getting Started / FAQ / Troubleshooting /
 *   Guides / Billing / Contact without round-tripping through the hub.
 *   The TopBar breadcrumb still shows "Support / <section>" with the
 *   parent link returning to the hub.
 *
 * Walkthrough fix 2026-05-11 — testers had to keep going back to the
 * hub to switch between Q&A surfaces; the tab band makes lateral
 * movement obvious.
 */
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

// Ordered list — drives the tab band on section views. Keep the order
// consistent with SupportHub's CATEGORIES so users see the same
// progression whether they land via cards or via tabs.
const SECTION_ORDER: SectionId[] = [
  "getting-started",
  "faq",
  "troubleshooting",
  "guides",
  "billing",
  "contact",
];

const SECTION_TITLES: Record<SectionId, string> = {
  "getting-started": "Getting Started",
  faq: "FAQ",
  troubleshooting: "Troubleshooting",
  guides: "Feature Guides",
  billing: "Account & Billing",
  contact: "Contact",
};

const SECTION_LONG_TITLES: Record<SectionId, string> = {
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

  // Section view — TopBar shows "Support / <section>" breadcrumb;
  // an in-page tab band lets users switch laterally between sections
  // without bouncing through the hub.
  return (
    <PageLayout
      title={SECTION_LONG_TITLES[activeSection]}
      subtitle={
        activeSection === "contact"
          ? "Report bugs, request features, or send feedback"
          : "Get help, find answers, and contact us"
      }
      parentLabel="Support"
      onParentClick={() => setActiveSection(null)}
      width="wide"
      tabs={{
        items: SECTION_ORDER.map((id) => ({
          key: id,
          label: SECTION_TITLES[id],
        })),
        activeKey: activeSection,
        onChange: (key) => setActiveSection(key as SectionId),
      }}
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
