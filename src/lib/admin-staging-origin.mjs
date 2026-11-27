export const ADMIN_STAGING_WORKER = "atlasez-admin-staging";
export const ADMIN_RELEASE_STAGING_WORKER = "atlasez-admin-release-staging";

/** @param {string | URL | undefined} value */
function stagingWorkerFromOrigin(value) {
  try {
    const origin = new URL(value ?? "");
    const [worker, account] = origin.hostname.split(".");
    const matches =
      origin.protocol === "https:" &&
      (worker === ADMIN_STAGING_WORKER ||
        worker === ADMIN_RELEASE_STAGING_WORKER) &&
      /^[a-z0-9-]+$/.test(account ?? "") &&
      origin.hostname === `${worker}.${account}.workers.dev`;
    return matches ? worker : null;
  } catch {
    return null;
  }
}

/** @param {string | URL | undefined} value */
export function isAdminStagingOrigin(value) {
  return stagingWorkerFromOrigin(value) !== null;
}

/** @param {string | URL | undefined} value */
export function isAdminReleaseStagingOrigin(value) {
  return stagingWorkerFromOrigin(value) === ADMIN_RELEASE_STAGING_WORKER;
}
