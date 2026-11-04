// Exercise the real web host, picker, persisted follows and ticker in the private tester.
const assert = require("node:assert/strict");

async function openWidget(page) {
  const main = page.frameLocator("iframe.main");
  await main.getByRole("button", { name: "Home", exact: true }).first().waitFor();
  const entry = main.getByRole("button", { name: "Election Results", exact: true });
  if (await entry.count()) {
    await entry.first().click();
  } else {
    await main.getByRole("button", { name: /pages on your bar used/ }).click();
    await main.locator("input").first().fill("Election");
    await main.getByRole("button", { name: "Add Election Results" }).click();
  }
  await main.getByRole("region", { name: "Find races" }).waitFor();
  return main;
}

async function reviewPicker(page, { verify }) {
  let main = await openWidget(page);
  const active = () => main.getByRole("combobox", { name: "Vote activity" });
  const office = () => main.getByRole("combobox", { name: "Office" });
  const state = () => main.getByRole("combobox", { name: "State" });
  const picker = () => main.getByRole("region", { name: "Find races" });
  assert.equal(await state().locator("option").count(), 52);
  const follows = [];
  const localIds = [];
  const initial = await main.getByRole("button", { name: /^Unfollow / }).count();
  if (verify || !initial) {
    await state().selectOption("TN");
    await office().selectOption("governor");
    const governor = main.getByRole("button", { name: "Follow Tennessee Governor", exact: true });
    await governor.click();
    follows.push("Tennessee Governor");
    await main.getByRole("article", { name: "Tennessee Governor", exact: true }).waitFor();
  }
  await state().selectOption("");
  await active().selectOption("votes_reported");
  for (const category of ["mayor", "city_council"]) {
    const response = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname.endsWith("/elections/search") && url.searchParams.get("office") === category && r.ok();
    });
    await office().selectOption(category);
    const { races, total } = await (await response).json();
    assert(total > 0 && races.length <= 12);
    const first = races[0];
    localIds.push(first.id);
    assert.equal(first.office, category);
    assert.equal(first.vote_status, "votes_reported");
    const alreadyFollowing = await main.getByRole("button", { name: "Unfollow " + first.name, exact: true }).count();
    if ((verify || !initial) && !alreadyFollowing) {
      await picker().getByRole("button", { name: "Follow " + first.name, exact: true }).first().click();
      follows.push(first.name);
      const article = main.getByRole("article", { name: first.name, exact: true }).first();
      await article.getByRole("table").waitFor({ timeout: 65_000 });
      assert.doesNotMatch(await article.innerText(), /leads by|calls it for/i);
      console.log(category, first.state, first.id, first.name, (await article.locator("tbody tr").first().innerText()).replace(/\s+/g," "));
    }
  }
  if (verify) {
    const ticker = page.frameLocator("iframe.ticker");
    const activityResult = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname.endsWith("/elections/search") && url.searchParams.get("activity") === "changed" && r.ok();
    });
    await active().selectOption("changed");
    const changes = await (await activityResult).json();
    assert(changes.total > 0 && changes.races.every(r => r.office === "city_council" && r.changed_at));
    await ticker.locator(localIds.map(id => `[data-race-id='${id}']`).join(",")).first().waitFor({ timeout: 60_000 });
    await page.reload();
    main = await openWidget(page);
    for (const name of follows) {
      const unfollow = main.getByRole("button", { name: "Unfollow " + name, exact: true }).first();
      await unfollow.click();
      await unfollow.waitFor({ state: "detached" });
    }
    console.log("National picker passed: 51 jurisdictions, TN governor, positive-vote mayor and council, candidate counts, ticker, persistence and unfollow.");
  } else {
    await office().selectOption("");
    await active().selectOption("");
    await picker().scrollIntoViewIfNeeded();
  }
}
module.exports = { openWidget, reviewPicker };
