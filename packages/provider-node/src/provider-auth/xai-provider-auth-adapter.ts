import {
  ProviderAuthInvalidGrantError,
  resolveProviderAuthTokenExpiresAt,
  type ProviderAuthAdapter,
  type ProviderAuthTokenSet,
} from "./provider-auth-engine.js";
import {
  pollXaiDeviceToken,
  refreshXaiAccessToken,
  requestXaiDeviceCode,
  resolveXaiDeviceCodeExpiresAt,
  XaiOAuthInvalidGrantError,
  type XaiOAuthDeps,
  type XaiTokenResponse,
} from "./xai-device-oauth.js";

function toTokenSet(tokens: XaiTokenResponse, now: number): ProviderAuthTokenSet {
  return {
    access: tokens.access_token,
    ...(tokens.refresh_token ? { refresh: tokens.refresh_token } : {}),
    ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
    expiresAt: resolveProviderAuthTokenExpiresAt(tokens.expires_in, now),
  };
}

export function createXaiProviderAuthAdapter(deps: XaiOAuthDeps): ProviderAuthAdapter {
  const now = deps.now ?? (() => Date.now());
  return {
    authProviderId: "xai",
    async startLogin() {
      const device = await requestXaiDeviceCode(deps);
      return {
        kind: "device-code",
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        ...(device.verification_uri_complete
          ? { verificationUriComplete: device.verification_uri_complete }
          : {}),
        expiresAt: resolveXaiDeviceCodeExpiresAt(device, now()),
        poll: async (signal) =>
          toTokenSet(await pollXaiDeviceToken(device, { ...deps, signal }), now()),
      };
    },
    async refresh(refreshToken) {
      try {
        return toTokenSet(await refreshXaiAccessToken(refreshToken, deps), now());
      } catch (error) {
        if (error instanceof XaiOAuthInvalidGrantError) {
          throw new ProviderAuthInvalidGrantError(error.message, { cause: error });
        }
        throw error;
      }
    },
  };
}
