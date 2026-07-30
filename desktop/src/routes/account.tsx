import { createFileRoute } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import SectionNav from "../components/layout/SectionNav";
import { WidgetBar } from "../components/widget-bar/Bar";
import AccountSettings from "../components/settings/AccountSettings";
import { resetAll } from "../preferences";
import { useShell } from "../shell-context";

export const Route = createFileRoute("/account")({
  component: AccountRoute,
  errorComponent: RouteError,
});

function AccountRoute() {
  const shell = useShell();

  const handleResetAll = () => {
    const next = resetAll();
    shell.onPrefsChange(next);
  };

  return (
    <PageLayout title="Account" width="wide" noTopPadding>
      <WidgetBar>
        <SectionNav active="account" />
      </WidgetBar>

      <div className="pt-4">
        <AccountSettings
          authenticated={shell.authenticated}
          tier={shell.tier}
          subscriptionInfo={shell.subscriptionInfo}
          onLogin={shell.onLogin}
          onLogout={shell.onLogout}
          onResetAll={handleResetAll}
        />
      </div>
    </PageLayout>
  );
}
