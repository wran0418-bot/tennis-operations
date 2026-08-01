import { isValidSession, sessionCookieName } from "@/auth";

export const runtime = "edge";

type Coach = {
  id: string;
  name: string;
  level?: string;
};

type Enrollment = {
  id: string;
  studentName: string;
  courseType: string;
  classLevel: string;
  courseName: string;
  commission: number;
  coachId: string;
  coachName?: string;
  startDate: string;
  classTime: string;
  settlementStatus: string;
  settlementMonth: string;
  totalLessons: number;
  weekdayPattern: string;
  sourceRecordId?: string;
};

type AppState = {
  importedAt?: string;
  coaches?: Coach[];
  enrollments?: Enrollment[];
  coachLessonRecords?: unknown[];
  coachHourAdjustments?: unknown[];
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

type SyncSummary = {
  configured: boolean;
  imported: number;
  skipped: number;
  updated: number;
  error?: string;
};

const STATE_KEY = "tennis_state";

const courseConfigs = {
  mwf6: {
    label: "一三五六人班",
    commission: 400,
    defaultPattern: "1,3,5",
    totalLessons: 12,
  },
  tt6: {
    label: "二四六人班",
    commission: 325,
    defaultPattern: "2,4",
    totalLessons: 8,
  },
  tt4: {
    label: "二四四人班",
    commission: 500,
    defaultPattern: "2,4",
    totalLessons: 8,
  },
};

const weekdayMap: Record<string, string> = {
  周日: "0",
  星期日: "0",
  周天: "0",
  周一: "1",
  星期一: "1",
  周二: "2",
  星期二: "2",
  周三: "3",
  星期三: "3",
  周四: "4",
  星期四: "4",
  周五: "5",
  星期五: "5",
  周六: "6",
  星期六: "6",
};

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
    registrationTableId: process.env.FEISHU_REGISTRATION_TABLE_ID || "",
    keyField: process.env.FEISHU_KEY_FIELD || "key",
    valueField: process.env.FEISHU_VALUE_FIELD || "value",
  };

  const missing = Object.entries(config)
    .filter(
      ([key, value]) =>
        key !== "keyField" &&
        key !== "valueField" &&
        key !== "registrationTableId" &&
        !value
    )
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

async function listRecords(tableId: string) {
  const { config } = getConfig();
  const path = `/bitable/v1/apps/${config.appToken}/tables/${tableId}/records?page_size=500`;
  const result = await feishuFetch(path);

  if (!result.configured) return { configured: false as const, records: [] };

  const payload = (await result.response.json()) as FeishuRecordListResponse;
  if (!result.response.ok || payload.code !== 0) {
    throw new Error(payload.msg || "Failed to list Feishu records");
  }

  return { configured: true as const, records: payload.data?.items || [] };
}

async function findStateRecord() {
  const { config } = getConfig();
  const result = await listRecords(config.tableId || "");
  if (!result.configured) return { configured: false as const };

  const record = result.records.find((item) => item.fields?.[config.keyField] === STATE_KEY);
  return { configured: true as const, record };
}

async function saveState(state: AppState) {
  const { config } = getConfig();
  const recordResult = await findStateRecord();
  if (!recordResult.configured) return { configured: false as const };

  const fields = {
    [config.keyField]: STATE_KEY,
    [config.valueField]: JSON.stringify(state),
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

  if (!result.configured) return { configured: false as const };

  const responsePayload = (await result.response.json()) as { code: number; msg?: string };
  if (!result.response.ok || responsePayload.code !== 0) {
    throw new Error(responsePayload.msg || "Failed to save Feishu state");
  }

  return { configured: true as const };
}

function normalizeState(state: AppState | null): AppState {
  return {
    importedAt: state?.importedAt || "",
    coaches: Array.isArray(state?.coaches) ? state.coaches : [],
    enrollments: Array.isArray(state?.enrollments) ? state.enrollments : [],
    coachLessonRecords: Array.isArray(state?.coachLessonRecords)
      ? state.coachLessonRecords
      : [],
    coachHourAdjustments: Array.isArray(state?.coachHourAdjustments)
      ? state.coachHourAdjustments
      : [],
    manualHours: state?.manualHours && typeof state.manualHours === "object" ? state.manualHours : {},
    cancellations: Array.isArray(state?.cancellations) ? state.cancellations : [],
  };
}

function fieldToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    return value.map(fieldToText).filter(Boolean).join(",");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "name", "value"]) {
      const text = fieldToText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fieldToDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return dateKey(new Date(value));
  }

  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    const nested = fieldToDate(record.timestamp || record.value || record.text);
    if (nested) return nested;
  }

  const text = fieldToText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : dateKey(parsed);
}

function resolveCourseType(value: unknown) {
  const text = fieldToText(value);
  if (text.includes("四人") || text.includes("4人") || text === "tt4") return "tt4";
  if (text.includes("二四") || text.includes("二、四") || text === "tt6") return "tt6";
  if (text.includes("一三五") || text.includes("一、三、五") || text === "mwf6") return "mwf6";
  return "";
}

function weekdayPatternFromField(value: unknown, fallback: string) {
  const text = fieldToText(value);
  if (!text) return fallback;

  const picked = new Set<string>();
  Object.entries(weekdayMap).forEach(([label, number]) => {
    if (text.includes(label)) picked.add(number);
  });

  if (!picked.size) {
    text
      .split(/[,\s，、/]+/)
      .map((item) => item.trim())
      .filter((item) => /^[0-6]$/.test(item))
      .forEach((item) => picked.add(item));
  }

  return picked.size ? Array.from(picked).sort().join(",") : fallback;
}

function findOrCreateCoach(state: AppState, coachName: string) {
  const coaches = state.coaches || [];
  const existing = coaches.find((coach) => coach.name === coachName);
  if (existing) return existing.id;

  const id = `coach-feishu-${encodeURIComponent(coachName)}`;
  coaches.push({ id, name: coachName, level: "middle" });
  state.coaches = coaches;
  return id;
}

function enrollmentFromRecord(record: FeishuRecord, state: AppState): Enrollment | null {
  const fields = record.fields || {};
  const studentName = fieldToText(fields["学员姓名"]);
  const coachName = fieldToText(fields["上课教练"]);
  const startDate = fieldToDate(fields["开课日期"]);
  const courseType = resolveCourseType(fields["课程类型"]);

  if (!studentName || !coachName || !startDate || !courseType) return null;

  const course = courseConfigs[courseType as keyof typeof courseConfigs];
  const id = fieldToText(fields["网页记录ID"]) || `feishu-${record.record_id}`;

  return {
    id,
    studentName,
    courseType,
    classLevel: fieldToText(fields["班级水平"]) || "提高班",
    courseName: course.label,
    commission: course.commission,
    coachId: findOrCreateCoach(state, coachName),
    coachName,
    startDate,
    classTime: fieldToText(fields["上课时间"]) || "7-9",
    settlementStatus: "未结算",
    settlementMonth: "",
    totalLessons: course.totalLessons,
    weekdayPattern: weekdayPatternFromField(fields["上课周期"], course.defaultPattern),
    sourceRecordId: record.record_id,
  };
}

async function markRegistrationSynced(recordId: string, enrollmentId: string) {
  const { config } = getConfig();
  const path = `/bitable/v1/apps/${config.appToken}/tables/${config.registrationTableId}/records/${recordId}`;
  const result = await feishuFetch(path, {
    method: "PUT",
    body: JSON.stringify({
      fields: {
        同步状态: "已同步",
        网页记录ID: enrollmentId,
      },
    }),
  });

  if (!result.configured) return false;

  const responsePayload = (await result.response.json()) as { code: number; msg?: string };
  if (!result.response.ok || responsePayload.code !== 0) {
    throw new Error(responsePayload.msg || "Failed to update registration row");
  }

  return true;
}

async function syncRegistrationsIntoState(state: AppState): Promise<SyncSummary> {
  const { config } = getConfig();
  if (!config.registrationTableId) {
    return { configured: false, imported: 0, skipped: 0, updated: 0 };
  }

  try {
    const result = await listRecords(config.registrationTableId);
    if (!result.configured) {
      return { configured: false, imported: 0, skipped: 0, updated: 0 };
    }

    state.enrollments = Array.isArray(state.enrollments) ? state.enrollments : [];
    let imported = 0;
    let skipped = 0;
    let updated = 0;

    for (const record of result.records) {
      const fields = record.fields || {};
      const recordId = `feishu-${record.record_id}`;
      const savedId = fieldToText(fields["网页记录ID"]);
      const alreadySynced = fieldToText(fields["同步状态"]) === "已同步";
      const alreadyExists = state.enrollments.some(
        (enrollment) =>
          enrollment.id === recordId ||
          enrollment.id === savedId ||
          enrollment.sourceRecordId === record.record_id
      );

      if (alreadyExists) {
        if (!alreadySynced) {
          await markRegistrationSynced(record.record_id, savedId || recordId);
          updated += 1;
        }
        skipped += 1;
        continue;
      }

      if (alreadySynced) {
        skipped += 1;
        continue;
      }

      const enrollment = enrollmentFromRecord(record, state);
      if (!enrollment) {
        skipped += 1;
        continue;
      }

      state.enrollments.push(enrollment);
      await markRegistrationSynced(record.record_id, enrollment.id);
      imported += 1;
      updated += 1;
    }

    return { configured: true, imported, skipped, updated };
  } catch (error) {
    return {
      configured: true,
      imported: 0,
      skipped: 0,
      updated: 0,
      error: error instanceof Error ? error.message : "Unexpected registration sync error",
    };
  }
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
    const rawState =
      typeof rawValue === "string" && rawValue.trim()
        ? (JSON.parse(rawValue) as AppState)
        : null;
    const state = normalizeState(rawState);
    const registrationSync = await syncRegistrationsIntoState(state);

    if (registrationSync.imported || registrationSync.updated) {
      await saveState(state);
    }

    return Response.json({
      configured: true,
      state,
      registrationSync,
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
    const payload = (await request.json()) as { state?: AppState };
    if (!payload.state || typeof payload.state !== "object") {
      return Response.json({ error: "state is required" }, { status: 400 });
    }

    const result = await saveState(payload.state);
    if (!result.configured) {
      return Response.json({ configured: false });
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
