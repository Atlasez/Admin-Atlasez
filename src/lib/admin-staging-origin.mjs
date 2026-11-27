export const ADMIN_STAGING_WORKER = "atlasez-admin-staging";
export const ADMIN_RELEASE_STAGING_WORKER = "atlasez-admin-release-staging";

/** @param {string | URL | undefined} value */
export function isAdminStagingOrigin(value) {
  try {
    const origin = new URL(value ?? "");
    const [worker, account] = origin.hostname.split(".");
    return (
      origin.protocol === "https:" &&
      (worker === ADMIN_STAGING_WORKER ||
        worker === ADMIN_RELEASE_STAGING_WORKER) &&
      /^[a-z0-9-]+$/.test(account ?? "") &&
      origin.hostname === `${worker}.${account}.workers.dev`
    );
  } catch {
    return false;
  }
}
