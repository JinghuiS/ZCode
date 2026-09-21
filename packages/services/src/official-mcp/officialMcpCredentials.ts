/*
 * ZCode 官方 Server MCP 的凭证解析与身份头构造。
 *
 * 本文件与 Off-Peak 的 offPeakRuntimeModel.ts **逻辑等价但完全独立**：
 * 不复用其函数、不修改其行为。理由是两者的套餐门槛、Team 支持范围与凭证通道预期会独立演进，
 * 共享 helper 会让任一侧的调整都变成需要评估双方影响的改动。
 *
 * 与 Off-Peak 的三处有意差异：
 *   1. 显式产出 Bigmodel-Target-Type（Off-Peak 侧当前没有生产者）；
 *   2. 不存在任何 mock 凭证分支（官方 MCP 无 mock 网关，测试用依赖注入替换来源）；
 *   3. 失败原因使用 official_* 分类，不复用 Off-Peak 的 reason 字符串。
 *
 * 凭证通道：Coding Plan 凭证走 `X-Bigmodel-Authorization` + MaaS 登录 JWT，
 * 不再发送 `X-Coding-Plan-Api-Key`。服务端把 API key 通道标为"仅存量客户端兼容"，且两个头同时
 * 发送是有害的——JWT 会赢得额度查询，但 API key 的归属校验仍会照跑，一把过期 key 就能让整个
 * 请求 403。Off-Peak 仍走 API key 通道，这也是上面"逻辑等价但完全独立"的又一个理由。
 */
import {
  OFFICIAL_MCP_AUTH_HEADER_NAMES,
  getModelProviderFamilySpec,
  type OfficialMcpAuthFailureReason,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";

const log = createServiceLogger("official-mcp");

const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const ACTIVE_OAUTH_PROVIDER_KEY = "oauth:active_provider";

/**
 * MaaS 登录 JWT 的凭证键（`oauth:<provider>:access_token`，见 oauth/repo/oauthCredentialRepo.ts）。
 *
 * 必须按 provider family 精确选择、**禁止跨 family 回退**：拿 ZAI 的业务 JWT 去打 BigModel 的
 * Coding Plan 只会得到一次注定失败的请求，而且失败原因会指向"没有套餐"这种误导结论。
 * 这几行与 bigmodelUsageQuotaProvider 的 reset 通道逻辑等价但独立（见文件头说明）。
 */
function maasJwtCredentialKey(providerFamily: "zai" | "bigmodel"): string {
  return `oauth:${getModelProviderFamilySpec(providerFamily).oauthProviderId}:access_token`;
}

/**
 * 只为日志算出 JWT 的剩余有效期（秒）。**不参与任何控制流**，解析失败返回 undefined。
 *
 * 存在理由：MaaS JWT 没有刷新链路，过期后服务端的表现是 queryCodingPlan 上游 401，
 * 客户端却收到"需要 Coding Plan"这类文案——真实原因与提示不符。有了这个数值，
 * "神秘的 403"能一眼看出是"token 早就过期了"。只记数字，绝不记 token 本身。
 */
function readJwtExpiresInSeconds(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded: unknown = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null) return undefined;
    const exp = (decoded as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return undefined;
    return Math.round(exp - Date.now() / 1000);
  } catch {
    return undefined;
  }
}

/** 凭证解析 info 日志的有效期分桶粒度（秒）；桶内不重复记录，见 createCredentialResolvedLogKey。 */
const CREDENTIAL_RESOLVED_LOG_BUCKET_SECONDS = 3600;

/**
 * 凭证解析成功日志的去重键（导出仅为可单测，无其他消费方）。
 *
 * 生产日志保留 JWT 有效期分桶，帮助区分凭据过期与套餐不可用，不记录凭据原文。
 * resolver 只合并正在执行的请求，没有时间缓存；因此按小时分桶去重，避免每次
 * MCP 调用都产生 info 日志。凭据有效期跨桶、进入 expired 或切换套餐类型时重新记录。
 */
function createCredentialResolvedLogKey(input: {
  providerFamily: "zai" | "bigmodel";
  planTargetType: string | null;
  maasJwtExpiresInSeconds: number | undefined;
}): string {
  const expires = input.maasJwtExpiresInSeconds;
  const expiryBucket =
    expires === undefined
      ? "unparsable"
      : expires <= 0
        ? "expired"
        : `t${Math.floor(expires / CREDENTIAL_RESOLVED_LOG_BUCKET_SECONDS)}`;
  return `${input.providerFamily}|${input.planTargetType ?? "none"}|${expiryBucket}`;
}

let lastCredentialResolvedLogKey: string | undefined;

interface OfficialMcpCredentialResolverDeps {
  credentialService: { load(key: string): Promise<string | null | undefined> };
}

export type OfficialMcpPlanScope =
  | { targetType: "PERSONAL" }
  | { targetType: "TEAM"; organizationId: string; projectId: string };

export type OfficialMcpWireScope = OfficialMcpPlanScope | null;

/** 解析成功后的凭证快照。仅在 host/service 进程内存活，脱敏后才允许过 RPC。 */
export interface OfficialMcpCredentialSnapshot {
  jwt: string;
  /**
   * MaaS 登录 JWT（`oauth:<family>:access_token` 的原文，**不带 Bearer 前缀**）。
   * 前缀在 buildOfficialMcpAuthHeaders 里加，与 reset / usage 通道的既有约定一致。
   */
  codingPlanAuthorization?: string;
  providerFamily: "zai" | "bigmodel";
  /** 当前选中连接的产品/额度归属；畸形旧 Team key 无法精确归属时为 null。 */
  planScope: OfficialMcpPlanScope | null;
  /** 实际发往 Server MCP 的身份头 scope；ZAI Team 与 Off-Peak 一致为 null。 */
  wireScope: OfficialMcpWireScope;
}

export type OfficialMcpCredentialOutcome =
  | { ok: true; snapshot: OfficialMcpCredentialSnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

function fail(reason: OfficialMcpAuthFailureReason): {
  ok: false;
  reason: OfficialMcpAuthFailureReason;
} {
  return { ok: false, reason };
}

type OfficialMcpIdentitySnapshot = {
  activeProvider: "zai" | "bigmodel";
  jwt: string;
  /** MaaS 登录 JWT；缺失表示登录态不完整。 */
  maasJwt: string;
};

async function readIdentitySnapshot(
  deps: OfficialMcpCredentialResolverDeps,
): Promise<
  | { ok: true; snapshot: OfficialMcpIdentitySnapshot }
  | { ok: false; reason: OfficialMcpAuthFailureReason }
> {
  const [activeProviderValue, jwtValue] = await Promise.all([
    deps.credentialService.load(ACTIVE_OAUTH_PROVIDER_KEY),
    deps.credentialService.load(ZCODE_JWT_TOKEN_KEY),
  ]);
  const activeProvider = activeProviderValue?.trim();
  const jwt = jwtValue?.trim() ?? "";
  if ((activeProvider !== "zai" && activeProvider !== "bigmodel") || !jwt) {
    return fail("official_auth_unavailable");
  }
  const maasJwt =
    (await deps.credentialService.load(maasJwtCredentialKey(activeProvider)))?.trim() ?? "";
  return { ok: true, snapshot: { activeProvider, jwt, maasJwt } };
}

function isSameIdentitySnapshot(
  before: OfficialMcpIdentitySnapshot,
  after: OfficialMcpIdentitySnapshot,
): boolean {
  return (
    before.activeProvider === after.activeProvider &&
    before.jwt === after.jwt &&
    before.maasJwt === after.maasJwt
  );
}

/**
 * 解析官方 MCP 凭证。
 *
 * 修复：智谱套餐已降级为普通 Provider，内置配置不再下发 `zhipu-account` 套餐连接，
 * 旧逻辑要求 Registry 中恰有一个 Coding Plan 连接，导致官方 MCP 永远判定为 plan_required。
 * 现在直接使用 Z.ai / BigModel 账号登录态（Provider 级账号登录复用同一套 OAuth 凭据），
 * 以个人（PERSONAL）scope 调用；套餐是否可用由服务端按账号判定。
 *
 * 防竞态：active provider、zcode JWT 与 MaaS JWT 前后各取一次并比对，
 * 任一不一致就整轮重来，绝不拼接两代凭证。两轮仍不稳定则按不可用返回。
 */
export async function resolveOfficialMcpCredentials(
  deps: OfficialMcpCredentialResolverDeps,
): Promise<OfficialMcpCredentialOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identity = await readIdentitySnapshot(deps);
    if (!identity.ok) {
      if (attempt === 0) continue;
      return identity;
    }
    const { activeProvider, jwt, maasJwt } = identity.snapshot;
    if (!maasJwt) {
      // 登录态不完整（需要重新登录），不是"没有套餐"。
      log.warn("official mcp maas jwt missing", {
        providerFamily: activeProvider,
        reason: "official_auth_unavailable",
      });
      return fail("official_auth_unavailable");
    }

    const latestIdentity = await readIdentitySnapshot(deps);
    if (!latestIdentity.ok || !isSameIdentitySnapshot(identity.snapshot, latestIdentity.snapshot)) {
      continue;
    }

    const planScope: OfficialMcpPlanScope = { targetType: "PERSONAL" };
    // info 而非 debug：MaaS JWT 剩余有效期是排障关键线索；只记剩余秒数，绝不记 token 本身。
    const maasJwtExpiresInSeconds = readJwtExpiresInSeconds(maasJwt);
    const logKey = createCredentialResolvedLogKey({
      providerFamily: activeProvider,
      planTargetType: planScope.targetType,
      maasJwtExpiresInSeconds,
    });
    if (logKey !== lastCredentialResolvedLogKey) {
      lastCredentialResolvedLogKey = logKey;
      log.info("official mcp credentials resolved", {
        maasJwtExpiresInSeconds,
        providerFamily: activeProvider,
        planTargetType: planScope.targetType,
      });
    }

    return {
      ok: true,
      snapshot: {
        codingPlanAuthorization: maasJwt,
        jwt,
        planScope,
        providerFamily: activeProvider,
        wireScope: planScope,
      },
    };
  }

  return fail("official_auth_unavailable");
}

/**
 * 由凭证快照构造本次请求的身份头。
 * Team 身份成对原子性：organization/project 任一缺失时两者都不发送。
 */
export function buildOfficialMcpAuthHeaders(
  snapshot: OfficialMcpCredentialSnapshot,
): Record<string, string> {
  const headers: Record<string, string> = {
    [OFFICIAL_MCP_AUTH_HEADER_NAMES.authorization]: `Bearer ${snapshot.jwt}`,
  };
  if (snapshot.codingPlanAuthorization) {
    // 服务端会 CutPrefix("Bearer ")，裸 token 也接受；这里按 MCP 接口文档发 Bearer 形式。
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.codingPlanAuthorization] =
      `Bearer ${snapshot.codingPlanAuthorization}`;
  }
  const scope = snapshot.wireScope;
  if (scope) {
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.targetType] = scope.targetType;
    if (scope.targetType === "TEAM") {
      headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.organization] = scope.organizationId;
      headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.project] = scope.projectId;
    }
  }
  return headers;
}

/** host handler 透传的请求上下文；不参与凭证选择。 */
interface OfficialMcpAuthHeadersRequestContext {
  mcpKey: string;
  pluginId: string;
  targetOrigin: string;
  workspace: { workspaceIdentity?: string; workspaceKey: string; workspacePath: string };
}

type OfficialMcpAuthHeadersOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

/**
 * 身份头解析入口，带 in-flight 去重。
 *
 * 只合并**并发**请求：已有解析在飞时后来者复用同一 Promise；settle 后立即丢弃，
 * 下一个请求重新完整解析。不做任何时间维度缓存，因此不存在"读到已被替换的旧凭证"的窗口。
 * 作用域为 host 全局——凭证是全局状态，按 plugin/mcpKey/workspace 分桶只会削弱去重、不增隔离。
 */
export function createOfficialMcpAuthHeadersResolver(deps: OfficialMcpCredentialResolverDeps): {
  resolveHeaders(
    request?: OfficialMcpAuthHeadersRequestContext,
  ): Promise<OfficialMcpAuthHeadersOutcome>;
} {
  let pending: Promise<OfficialMcpAuthHeadersOutcome> | null = null;

  return {
    // request 仅为契约对齐（host handler 已在此之前完成可信校验，见 zcodeAgentService）；
    // 凭据是 host 全局状态，**不**按 plugin/mcpKey/workspace 分桶——分桶只会削弱 in-flight
    // 去重而不增加隔离。参数保留是为了将来审计需要时不必再改接口。
    resolveHeaders(_request?: OfficialMcpAuthHeadersRequestContext) {
      if (pending) return pending;
      const inFlight = (async (): Promise<OfficialMcpAuthHeadersOutcome> => {
        const outcome = await resolveOfficialMcpCredentials(deps);
        if (!outcome.ok) return { ok: false, reason: outcome.reason };
        return { ok: true, headers: buildOfficialMcpAuthHeaders(outcome.snapshot) };
      })();
      pending = inFlight;
      // 用双 handler 的 then 而非 finally：finally 会派生一个同样 reject 的 promise，
      // 调用方只 await 了 inFlight，那个派生 promise 无人处理会变成 unhandled rejection。
      // 解析抛错也必须清空 slot，否则后续请求会永久复用失败的 Promise。
      const clear = (): void => {
        if (pending === inFlight) pending = null;
      };
      inFlight.then(clear, clear);
      return inFlight;
    },
  };
}
