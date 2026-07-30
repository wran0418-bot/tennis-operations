import { isValidSession, sessionCookieName } from "@/auth";

export const runtime = "edge";

type AppState = {
  importedAt?: string;
  coaches?: unknown[];
  enrollments?: unknown[];
  manualHours?: Record<string, unknown>;
  cancellations?: unknown[];
};

type FeishuTokenResponse = {
  code: number;
  msg?: string;
  tenant_access_token?: string;
};

type FeishuRecord = {
  record_id: string;
  fields?: Record<string, unknown>;
};

type FeishuRecordListResponse = {
  code: number;
  msg?: string;
  data?: {
    items?: FeishuRecord[];
  };
};

const STATE_KEY = "tennis_state";

async function requireSession(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const session = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookieName()}=`))
    ?.slice(sessionCookieName().length + 1);

  return isValidSession(session ? decodeURIComponent(session) : null);
}

function getConfig() {
  const config = {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    appToken: process.env.FEISHU_BITABLE_APP_TOKEN,
    tableId: process.env.FEISHU_STATE_TABLE_ID,
    keyField: process.env.FEISHU_KEY_FIELD || "key",
    valueField: process.env.FEISHU_VALUE_FIELD || "value",
  };

  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "keyField" && key !== "valueField" && !value)
    .map(([key]) => key);

  return { config, missing };
}

async function feishuFetch(path: string, init: RequestInit = {}) {
  const { config, missing } = getConfig();
  if (missing.length) {
    return {
      configured: false,
      response: Response.json({
        configured: false,
        error: `Missing Feishu config: ${missing.join(", ")}`,
      }),
    };
  }

  const tokenResponse = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
      }),
    }
  );
  const tokenPayload = (await tokenResponse.json()) as FeishuTokenResponse;

  if (!tokenResponse.ok || tokenPayload.code !== 0 || !tokenPayload.tenant_access_token) {
    throw new Error(tokenPayload.msg || "Failed to get Feishu tenant token");
  }

  return {
    configured: true,
    response: await fetch(`https://open.feishu.cn/open-apis${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${tokenPayload.tenant_access_token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    }),
  };
}

async function findStateRecord() {
  const { config } = getConfig();
  const path = `/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records?page_size=100`;
  const result = await feishuFetch(path);

  if (!result.configured) return { configured: false as const };

  const payload = (await result.response.json()) as FeishuRecordListResponse;
  if (!result.response.ok || payload.code !== 0) {
    throw new Error(payload.msg || "Failed to list Feishu records");
  }

  const record = payload.data?.items?.find(
    (item) => item.fields?.[config.keyField] === STATE_KEY
  );

  return { configured: true as const, record };
}

export async function GET(request: Request) {
  if (!(await requireSession(request))) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { config } = getConfig();
    const result = await findStateRecord();

    if (!result.configured) {
      return Response.json({ configured: false, state: null });
    }

    const rawValue = result.record?.fields?.[config.valueField];
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      return Response.json({ configured: true, state: null });
    }

    return Response.json({
      configured: true,
      state: JSON.parse(rawValue) as AppState,
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Unexpected Feishu error",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  if (!(await requireSession(request))) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { config } = getConfig();
    const payload = (await request.json()) as { state?: AppState };
    if (!payload.state || typeof payload.state !== "object") {
      return Response.json({ error: "state is required" }, { status: 400 });
    }

    const recordResult = await findStateRecord();
    if (!recordResult.configured) {
      return Response.json({ configured: false });
    }

    const fields = {
      [config.keyField]: STATE_KEY,
      [config.valueField]: JSON.stringify(payload.state),
    };

    const basePath = `/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`;
    const result = recordResult.record
      ? await feishuFetch(`${basePath}/${recordResult.record.record_id}`, {
          method: "PUT",
          body: JSON.stringify({ fields }),
        })
      : await feishuFetch(basePath, {
          method: "POST",
          body: JSON.stringify({ fields }),
        });

    if (!result.configured) {
      return Response.json({ configured: false });
    }

    const responsePayload = (await result.response.json()) as { code: number; msg?: string };
    if (!result.response.ok || responsePayload.code !== 0) {
      throw new Error(responsePayload.msg || "Failed to save Feishu state");
    }

    return Response.json({ configured: true, ok: true });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Unexpected Feishu error",
      },
      { status: 500 }
    );
  }
}
