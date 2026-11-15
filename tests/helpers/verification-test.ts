import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

export { expect };

export const test = base.extend<{ verificationCapture: void }>({
  verificationCapture: [
    async ({ page }, use, testInfo) => {
      const consoleErrors: string[] = [];
      const externalRequestsBlocked: string[] = [];
      const localOrigin = new URL(
        String(testInfo.project.use.baseURL ?? "http://localhost:4321"),
      ).origin;
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      await page.route("**/*", async (route) => {
        const target = new URL(route.request().url());
        if (target.origin !== localOrigin) {
          externalRequestsBlocked.push(target.origin);
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      try {
        await use();
      } finally {
        await testInfo.attach("browser-console-errors.json", {
          body: Buffer.from(JSON.stringify(consoleErrors, null, 2)),
          contentType: "application/json",
        });
        await testInfo.attach("external-requests-blocked.json", {
          body: Buffer.from(
            JSON.stringify([...new Set(externalRequestsBlocked)], null, 2),
          ),
          contentType: "application/json",
        });
      }
    },
    { auto: true },
  ],
});

export type { Locator, Page };
