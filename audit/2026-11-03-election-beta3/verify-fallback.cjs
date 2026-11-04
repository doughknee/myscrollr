const assert = require("node:assert/strict");
const path = require("node:path");
const { openWidget } = require("./verify-national.cjs");
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(__dirname, "../../desktop")] }));

async function verify({origin, session, step}) {
  const browser = await chromium.launch(process.platform === "win32" ? {channel:"msedge"} : {});
  try {
    const page = await browser.newPage();
    await page.addInitScript(({origin, session}) => {
      if (location.origin !== origin) return;
      localStorage.setItem("tauri-store:scrollr.json:scrollr:store-migrated", "true");
      localStorage.setItem("tauri-store:scrollr.json:scrollr:auth", JSON.stringify(session));
    }, {origin, session});
    await page.goto(origin + "/web.html");
    const main = await openWidget(page);
    await main.getByRole("combobox", {name:"State"}).selectOption("TN");
    await main.getByRole("combobox", {name:"Office"}).selectOption("governor");
    await main.getByRole("button", {name:"Follow Tennessee Governor", exact:true}).click();
    const ticker = page.frameLocator("iframe.ticker").locator("[data-race-id='87476']").first();
    await ticker.filter({hasText:"Preview A leads by 40 votes"}).waitFor({timeout:45000});
    step("nationwide",true);
    await ticker.filter({hasText:"Nationwide returns"}).waitFor({timeout:45000});
    const displayed = await ticker.innerText();
    assert.match(displayed,/220/);
    assert.match(displayed,/180/);
    assert.doesNotMatch(displayed,/Delayed/);
    step("recovery",true);
    await ticker.filter({hasText:"Preview A leads by 40 votes"}).waitFor({timeout:45000});
    console.log("Open ticker passed: detail, fresh nationwide totals (220 and 180), then recovered detail.");
  } finally { await browser.close(); }
}
module.exports = {verify};
