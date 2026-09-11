const mutationEvent = "scrollr:product-analytics-consent-mutation";

export function signalProductAnalyticsConsentMutation(): void {
  window.dispatchEvent(new Event(mutationEvent));
}

export function hydrateProductAnalyticsConsent(
  load: () => Promise<boolean>,
  apply: (enabled: boolean) => void,
): () => void {
  let current = true;
  const cancel = () => {
    current = false;
  };
  window.addEventListener(mutationEvent, cancel);
  void load()
    .then((enabled) => {
      if (current) apply(enabled);
    })
    .catch(() => {});
  return () => {
    current = false;
    window.removeEventListener(mutationEvent, cancel);
  };
}
