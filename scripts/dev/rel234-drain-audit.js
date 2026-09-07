(() => {
  const buf = window.__tickerAudit || [];
  window.__tickerAudit = [];
  return buf;
})()
