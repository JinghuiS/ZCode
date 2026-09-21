import {
  ProviderAuthInvalidGrantError,
  resolveProviderAuthTokenExpiresAt,
  type DeviceCodeProviderAuthAdapter,
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

export function createXaiProviderAuthAdapter(deps: XaiOAuthDeps): DeviceCodeProviderAuthAdapter {
  const now = deps.now ?? (() => Date.now());
  return {
    kind: "device-code",
    authProviderId: "xai",
    async startDeviceLogin() {
      const device = await requestXaiDeviceCode(deps);
      return {
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
