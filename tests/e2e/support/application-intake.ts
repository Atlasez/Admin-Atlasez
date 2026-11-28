import type { Page } from "@playwright/test";

/** Local E2E pages have no Worker API, so state explicitly that intake is open. */
export async function mockOpenApplicationIntake(page: Page) {
  await page.route("**/api/public/application-intake-status", (route) =>
    route.fulfill({ json: { open: true } }),
  );
}
