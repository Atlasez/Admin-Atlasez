import { expect, test } from "@playwright/test";

test("同時作業会ページからプロジェクトのカレンダーを開ける", async ({
  page,
}) => {
  await page.goto("./admin/co-working/?project=atlas");
  await expect(page.getByRole("heading", { name: "同時作業会" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "カレンダーを開く" }),
  ).toHaveAttribute("href", "/admin/calendar/?project=atlas");
});
