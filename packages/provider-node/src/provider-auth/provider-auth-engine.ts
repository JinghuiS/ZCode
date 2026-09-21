import { randomUUID } from "node:crypto";
import {
  providerAuthCredentialKey,
  type ProviderAuthAccount,
  type ProviderAuthLoginStart,
  type ProviderAuthLoginResult,
  type ProviderAuthProviderId,
  type ProviderAuthStatus,
} from "@zcode/shared/provider-auth";
import { z } from "zod";

/**
 * Provider 级认证引擎：凭据归属 `provider-auth:<authProviderId>`。
 *
 * Host（services）与独立 CLI 都可以注入自己的凭据存储复用本引擎；
 * 协议差异由 adapter 隔离，后续 Anthropic / OpenAI OAuth、GitHub Copilot 只需新增 adapter。
 */

// 提前刷新窗口：避免长工具调用中途 401。与 OpenCode 保持一致。
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 3600 * 1000;

export interface ProviderAuthTokenSet {
  access: string;
  refresh?: string;
  idToken?: string;
  /** Unix 毫秒；服务端未返回 expires_in 时按 1 小时估算，并以 JWT exp 兜底。 */
  expiresAt: number;
  /** adapter 已知的账号信息；缺省时从 id_token / access token 的 JWT claims 解析。 */
  account?: ProviderAuthAccount;
}

export class ProviderAuthInvalidGrantError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderAuthInvalidGrantError";
  }
}

export interface ProviderAuthLoginHandle {
  kind: "device-code" | "browser";
  userCode?: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  poll(signal: AbortSignal): Promise<ProviderAuthTokenSet>;
}

export interface ProviderAuthAdapter {
  readonly authProviderId: ProviderAuthProviderId;
  startLogin(): Promise<ProviderAuthLoginHandle>;
  /** 可轮换 token 的 provider 实现；refresh_token 被拒绝时必须抛 ProviderAuthInvalidGrantError。 */
  refresh?(refreshToken: string): Promise<ProviderAuthTokenSet>;
  /** 登出时清理 adapter 自有的外部会话（如智谱 OAuth 登录态）。 */
  onLogout?(): Promise<void>;
}

/**
 * 凭据存储端口。withLock 必须是跨进程互斥：桌面端每个窗口有独立 Host 进程，
 * 而 refresh_token 是轮换的，并发刷新会互相作废。
 */
export interface ProviderAuthCredentialStore {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}

const storedCredentialSchema = z
  .object({
    version: z.literal(1),
    access: z.string().min(1),
    refresh: z.string().min(1).optional(),
    idToken: z.string().optional(),
    expiresAt: z.number(),
    account: z
      .object({
        email: z.string().optional(),
        name: z.string().optional(),
        subject: z.string().optional(),
      })
      .optional(),
    /** refresh 被 invalid_grant 拒绝后置位；保留账号信息供 UI 提示重新登录。 */
    invalid: z.boolean().optional(),
  })
  .strict();
type StoredCredential = z.infer<typeof storedCredentialSchema>;

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const payload: unknown = JSON.parse(json);
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 只用于判断是否提前刷新，不做信任决策，因此不验签。非 JWT 返回 false。 */
function jwtExpiresWithin(token: string, skewMs: number, now: number): boolean {
  const exp = decodeJwtPayload(token)?.["exp"];
  return typeof exp === "number" && exp * 1000 <= now + skewMs;
}

function resolveAccount(tokens: ProviderAuthTokenSet): ProviderAuthAccount | undefined {
  const claims = decodeJwtPayload(tokens.idToken) ?? decodeJwtPayload(tokens.access);
  if (!claims) return undefined;
  const email = typeof claims["email"] === "string" ? claims["email"] : undefined;
  const subject = typeof claims["sub"] === "string" ? claims["sub"] : undefined;
  return email || subject
    ? { ...(email ? { email } : {}), ...(subject ? { subject } : {}) }
    : undefined;
}

interface LoginSession {
  authProviderId: ProviderAuthProviderId;
  controller: AbortController;
  result: Promise<ProviderAuthLoginResult>;
}

export interface ProviderAuthEngineOptions {
  store: ProviderAuthCredentialStore;
  adapters: readonly ProviderAuthAdapter[];
  now?: () => number;
  /** 凭据变化（登录、登出、失效）后通知，Host 用于跨窗口广播。 */
  onChanged?: (authProviderId: ProviderAuthProviderId) => void;
}

export class ProviderAuthEngine {
  private readonly adapters = new Map<ProviderAuthProviderId, ProviderAuthAdapter>();
  private readonly loginSessions = new Map<string, LoginSession>();
  private readonly refreshFlights = new Map<ProviderAuthProviderId, Promise<string>>();
  private readonly now: () => number;

  constructor(private readonly options: ProviderAuthEngineOptions) {
    for (const adapter of options.adapters) this.adapters.set(adapter.authProviderId, adapter);
    this.now = options.now ?? (() => Date.now());
  }

  /** 依赖装配顺序较晚的 adapter（如依赖 OAuth 服务的智谱账号）在创建后注册。 */
  registerAdapter(adapter: ProviderAuthAdapter): void {
    this.adapters.set(adapter.authProviderId, adapter);
  }

  private requireAdapter(authProviderId: ProviderAuthProviderId): ProviderAuthAdapter {
    const adapter = this.adapters.get(authProviderId);
    if (!adapter) throw new Error(`Unsupported provider auth: ${authProviderId}`);
    return adapter;
  }

  private async readCredential(
    authProviderId: ProviderAuthProviderId,
  ): Promise<StoredCredential | null> {
    const raw = await this.options.store.load(providerAuthCredentialKey(authProviderId));
    if (!raw) return null;
    try {
      const parsed = storedCredentialSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async writeCredential(
    authProviderId: ProviderAuthProviderId,
    credential: StoredCredential,
  ): Promise<void> {
    await this.options.store.save(
      providerAuthCredentialKey(authProviderId),
      JSON.stringify(credential),
    );
  }

  private toStoredCredential(
    tokens: ProviderAuthTokenSet,
    previous?: StoredCredential | null,
  ): StoredCredential {
    const account = tokens.account ?? resolveAccount(tokens) ?? previous?.account;
    return {
      version: 1,
      access: tokens.access,
      // 部分授权服务刷新时不轮换 refresh_token，此时沿用旧值。
      ...((tokens.refresh ?? previous?.refresh)
        ? { refresh: tokens.refresh ?? previous?.refresh }
        : {}),
      ...((tokens.idToken ?? previous?.idToken)
        ? { idToken: tokens.idToken ?? previous?.idToken }
        : {}),
      expiresAt: tokens.expiresAt,
      ...(account ? { account } : {}),
    };
  }

  async getStatus(authProviderId: ProviderAuthProviderId): Promise<ProviderAuthStatus> {
    this.requireAdapter(authProviderId);
    const credential = await this.readCredential(authProviderId);
    if (!credential) return { authProviderId, status: "disconnected" };
    return {
      authProviderId,
      status: credential.invalid ? "expired" : "connected",
      ...(credential.account ? { account: credential.account } : {}),
    };
  }

  async startLogin(authProviderId: ProviderAuthProviderId): Promise<ProviderAuthLoginStart> {
    const adapter = this.requireAdapter(authProviderId);
    // 同一 provider 只保留一个进行中的登录，重复发起时取消旧会话。
    for (const [loginId, session] of this.loginSessions) {
      if (session.authProviderId === authProviderId) this.cancelLogin(loginId);
    }
    const handle = await adapter.startLogin();
    const loginId = randomUUID();
    const controller = new AbortController();
    const result = handle
      .poll(controller.signal)
      .then(async (tokens): Promise<ProviderAuthLoginResult> => {
        const credential = this.toStoredCredential(tokens);
        await this.options.store.withLock(() => this.writeCredential(authProviderId, credential));
        this.options.onChanged?.(authProviderId);
        return {
          status: "connected",
          ...(credential.account ? { account: credential.account } : {}),
        };
      })
      .catch((error: unknown): ProviderAuthLoginResult => {
        if (controller.signal.aborted) return { status: "cancelled" };
        return {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        this.loginSessions.delete(loginId);
      });
    this.loginSessions.set(loginId, { authProviderId, controller, result });
    return {
      loginId,
      authProviderId,
      kind: handle.kind,
      ...(handle.userCode ? { userCode: handle.userCode } : {}),
      verificationUri: handle.verificationUri,
      ...(handle.verificationUriComplete
        ? { verificationUriComplete: handle.verificationUriComplete }
        : {}),
      expiresAt: handle.expiresAt,
    };
  }

  async awaitLogin(loginId: string): Promise<ProviderAuthLoginResult> {
    const session = this.loginSessions.get(loginId);
    if (!session) return { status: "failed", errorMessage: "Login session not found or finished" };
    return session.result;
  }

  cancelLogin(loginId: string): void {
    this.loginSessions.get(loginId)?.controller.abort(new Error("Login cancelled"));
  }

  async logout(authProviderId: ProviderAuthProviderId): Promise<void> {
    const adapter = this.requireAdapter(authProviderId);
    await adapter.onLogout?.();
    await this.options.store.withLock(() =>
      this.options.store.delete(providerAuthCredentialKey(authProviderId)),
    );
    this.options.onChanged?.(authProviderId);
  }

  /**
   * 返回当前可用的 access token；即将过期时刷新。
   *
   * 进程内 single-flight 合并并发请求；跨进程通过 store.withLock 串行，
   * 拿到锁后重读凭据——其他进程可能已经刷新过，此时直接使用新 token，不再消耗 refresh_token。
   */
  async resolveAccessToken(authProviderId: ProviderAuthProviderId): Promise<string> {
    const adapter = this.requireAdapter(authProviderId);
    const current = await this.readCredential(authProviderId);
    if (!current)
      throw new Error(
        `${authProviderId} account is not connected. Sign in from Settings → Models.`,
      );
    if (current.invalid) throw new Error(`${authProviderId} sign-in expired, please sign in again`);
    if (!this.shouldRefresh(current)) return current.access;

    const inflight = this.refreshFlights.get(authProviderId);
    if (inflight) return inflight;
    const flight = this.options.store
      .withLock(async () => {
        const latest = await this.readCredential(authProviderId);
        if (!latest)
          throw new Error(
            `${authProviderId} account is not connected. Sign in from Settings → Models.`,
          );
        if (latest.invalid)
          throw new Error(`${authProviderId} sign-in expired, please sign in again`);
        if (!this.shouldRefresh(latest)) return latest.access;
        if (!latest.refresh || !adapter.refresh) {
          throw new Error(`${authProviderId} session has no refresh token, please sign in again`);
        }
        try {
          const tokens = await adapter.refresh(latest.refresh);
          const next = this.toStoredCredential(tokens, latest);
          await this.writeCredential(authProviderId, next);
          return next.access;
        } catch (error) {
          if (error instanceof ProviderAuthInvalidGrantError) {
            // 只有服务端明确拒绝才标记失效；网络错误保留凭据，下次请求重试。
            await this.writeCredential(authProviderId, { ...latest, invalid: true });
            this.options.onChanged?.(authProviderId);
          }
          throw error;
        }
      })
      .finally(() => {
        this.refreshFlights.delete(authProviderId);
      });
    this.refreshFlights.set(authProviderId, flight);
    return flight;
  }

  private shouldRefresh(credential: StoredCredential): boolean {
    const now = this.now();
    return (
      credential.expiresAt - now <= ACCESS_TOKEN_REFRESH_SKEW_MS ||
      jwtExpiresWithin(credential.access, ACCESS_TOKEN_REFRESH_SKEW_MS, now)
    );
  }
}

export function resolveProviderAuthTokenExpiresAt(
  expiresInSeconds: number | undefined,
  now: number,
): number {
  const seconds = Number(expiresInSeconds);
  return (
    now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_ACCESS_TOKEN_TTL_MS)
  );
}
