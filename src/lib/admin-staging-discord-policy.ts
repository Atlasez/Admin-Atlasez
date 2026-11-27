import { isAdminStagingOrigin } from "./admin-staging-origin.mjs";

type StagingDiscordEnvironment = {
  ATLASEZ_STAGING_MODE?: string;
  ATLASEZ_STAGING_DISCORD_MODE?: string;
  ATLASEZ_STAGING_DISCORD_POLICY_APPROVED?: string;
  ATLASEZ_PRODUCTION_DISCORD_GUILD_ID?: string;
  ATLASEZ_PRODUCTION_DISCORD_CLIENT_ID?: string;
  ADMIN_PUBLIC_ORIGIN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_GUILD_NAME?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_OAUTH_CLIENT_ID?: string;
  DISCORD_OAUTH_CLIENT_SECRET?: string;
  DISCORD_OAUTH_REDIRECT_URI?: string;
  DISCORD_OAUTH_TOKEN_ENCRYPTION_KEY?: string;
};

const stagingDiscordIdentityIsComplete = (env: StagingDiscordEnvironment) => {
  const guildId = env.DISCORD_GUILD_ID?.trim() ?? "";
  const clientId = env.DISCORD_OAUTH_CLIENT_ID?.trim() ?? "";
  const name = env.DISCORD_GUILD_NAME?.trim() ?? "";
  const origin = env.ADMIN_PUBLIC_ORIGIN?.trim() ?? "";
  const redirect = env.DISCORD_OAUTH_REDIRECT_URI?.trim() ?? "";
  const productionGuildId =
    env.ATLASEZ_PRODUCTION_DISCORD_GUILD_ID?.trim() ?? "";
  const productionClientId =
    env.ATLASEZ_PRODUCTION_DISCORD_CLIENT_ID?.trim() ?? "";
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const encryptionKey = env.DISCORD_OAUTH_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  let encryptionKeyIsValid = /^[0-9a-f]{64}$/i.test(encryptionKey);
  if (!encryptionKeyIsValid) {
    try {
      encryptionKeyIsValid = atob(encryptionKey).length === 32;
    } catch {
      encryptionKeyIsValid = false;
    }
  }

  return (
    /^\d{17,20}$/.test(guildId) &&
    /^\d{17,20}$/.test(clientId) &&
    /^\d{17,20}$/.test(productionGuildId) &&
    /^\d{17,20}$/.test(productionClientId) &&
    productionGuildId !== productionClientId &&
    guildId !== clientId &&
    guildId !== productionGuildId &&
    guildId !== productionClientId &&
    clientId !== productionGuildId &&
    clientId !== productionClientId &&
    /staging|test/i.test(name) &&
    Boolean(env.DISCORD_BOT_TOKEN?.trim()) &&
    Boolean(env.DISCORD_OAUTH_CLIENT_SECRET?.trim()) &&
    encryptionKeyIsValid &&
    isAdminStagingOrigin(originUrl) &&
    !originUrl.username &&
    !originUrl.password &&
    !originUrl.port &&
    originUrl.pathname === "/" &&
    !originUrl.search &&
    !originUrl.hash &&
    (!redirect || redirect === `${originUrl.origin}/auth/discord/callback`)
  );
};

export const isAdminStagingEnvironment = (env: StagingDiscordEnvironment) => {
  if (
    env.ATLASEZ_STAGING_MODE !== undefined ||
    env.ATLASEZ_STAGING_DISCORD_MODE !== undefined
  )
    return true;
  return isAdminStagingOrigin(env.ADMIN_PUBLIC_ORIGIN);
};

/** Production keeps its existing Discord behavior. Staging opts in only as a complete, approved test-guild profile. */
export const isStagingDiscordEnabled = (env: StagingDiscordEnvironment) =>
  isAdminStagingEnvironment(env) &&
  env.ATLASEZ_STAGING_MODE === "true" &&
  env.ATLASEZ_STAGING_DISCORD_MODE === "test-guild" &&
  env.ATLASEZ_STAGING_DISCORD_POLICY_APPROVED === "true" &&
  stagingDiscordIdentityIsComplete(env);

export const isStagingDiscordDisabled = (env: StagingDiscordEnvironment) =>
  isAdminStagingEnvironment(env) && !isStagingDiscordEnabled(env);

export const isDiscordOperationPath = (pathname: string) =>
  pathname === "/auth/discord/start" ||
  pathname === "/auth/discord/callback" ||
  pathname === "/api/admin/discord-member-roles" ||
  pathname === "/api/admin/member-discord-user" ||
  pathname === "/api/admin/member-discord-roles" ||
  pathname === "/api/admin/discord-readiness" ||
  pathname === "/api/admin/discord-provision-roles" ||
  /^\/api\/admin\/applications\/[0-9a-f-]{36}\/discord-retry$/i.test(pathname);
