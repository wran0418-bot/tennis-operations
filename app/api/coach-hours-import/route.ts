import * as XLSX from "xlsx";
import { isValidSession, sessionCookieName } from "@/auth";

export const runtime = "nodejs";

type ParsedLessonRecord = {
  id: string;
  sourceKey: string;
  importMonth: string;
  coachName: string;
  courseName: string;
  courseType: "私教" | "陪打" | "月卡课" | "团课";
  lessonDate: string;
  lessonTime: string;
  duration: number;
  rawDuration: number;
  venue: string;
  students: string;
  studentCount: number;
  revenue: number;
  assistant: string;
  sourceFile: string;
  importedAt: string;
};

type FeishuTokenResponse = {
  code: number;
  msg?: string;
  tenant_access_token?: string;
};

type FeishuFieldListResponse = {
  code: number;
  msg?: string;
  data?: {
    items?: Array<{
      field_name?: string;
    }>;
  };
};

const lessonRecordFields = [
  "导入月份",
  "教练名称",
  "课程名称",
  "课程类型",
  "上课日期",
  "上课时间",
  "统计课时",
  "原始课时",
  "上课地点",
  "学员",
  "学员人数",
  "上课实收",
  "助教",
  "来源文件",
  "sourceKey",
];

async function requireSession(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const session = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookieName()}=`))
    ?.slice(sessionCookieName().length + 1);

  return isValidSession(session ? decodeURIComponent(session) : null);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateKey(value);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const raw = text(value);
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(raw)) {
    const [year, month, day] = raw
      .slice(0, 10)
      .replaceAll("/", "-")
      .split("-")
      .map(Number);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : dateKey(parsed);
}

function classifyCourse(courseName: string): ParsedLessonRecord["courseType"] {
  if (courseName.includes("私教")) return "私教";
  if (courseName.includes("陪打")) return "陪打";
  if (courseName.includes("月卡课")) return "月卡课";
  return "团课";
}

function countStudents(students: string) {
  return students
    .split(/[,，、;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function getField(row: Record<string, unknown>, names: string[]) {
  const normalized = Object.entries(row).reduce<Record<string, unknown>>(
    (result, [key, value]) => {
      result[key.replace(/\s/g, "")] = value;
      return result;
    },
    {}
  );
  for (const name of names) {
    const value = normalized[name.replace(/\s/g, "")];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return "";
}

function makeSourceKey(record: Omit<ParsedLessonRecord, "id" | "sourceKey" | "importedAt">) {
  return [
    record.importMonth,
    record.coachName,
    record.courseName,
    record.lessonDate,
    record.lessonTime,
    record.students,
    record.venue,
  ].join("|");
}

function parseRows(rows: Record<string, unknown>[], sourceFile: string) {
  const importedAt = new Date().toISOString();

  return rows
    .map((row) => {
      const coachName = text(getField(row, ["教练名称", "教练"]));
      const courseName = text(getField(row, ["课程名称"]));
      const lessonDate = parseDate(getField(row, ["上课日期", "日期"]));
      const lessonTime = text(getField(row, ["上课时间", "时间"]));
      const rawDuration = numberValue(getField(row, ["上课时长(小时)", "上课时长（小时）", "上课时长", "课时"]));
      const venue = text(getField(row, ["上课地点", "场地"]));
      const students = text(getField(row, ["学员", "学员名称"]));
      const revenue = numberValue(getField(row, ["上课实收(元)", "上课实收（元）", "上课实收"]));
      const assistant = text(getField(row, ["助教"]));
      const courseType = classifyCourse(courseName);
      const studentCount = countStudents(students);
      const duration = courseType === "团课" ? (studentCount >= 3 ? 2 : 1) : rawDuration;
      const importMonth = lessonDate.slice(0, 7);

      if (!coachName || !courseName || !lessonDate) return null;

      const baseRecord = {
        importMonth,
        coachName,
        courseName,
        courseType,
        lessonDate,
        lessonTime,
        duration,
        rawDuration,
        venue,
        students,
        studentCount,
        revenue,
        assistant,
        sourceFile,
      };
      const sourceKey = makeSourceKey(baseRecord);

      return {
        ...baseRecord,
        id: `lesson-${Buffer.from(sourceKey).toString("base64url").slice(0, 32)}`,
        sourceKey,
        importedAt,
      };
    })
    .filter(Boolean) as ParsedLessonRecord[];
}

async function getFeishuToken() {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) return "";

  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
    }
  );
  const payload = (await response.json()) as FeishuTokenResponse;
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) return "";
  return payload.tenant_access_token;
}

async function writeRecordsToFeishu(records: ParsedLessonRecord[]) {
  const appToken =
    process.env.FEISHU_LESSON_RECORD_APP_TOKEN || "Opz0bkNcbacmZZsPKjWcsxuWnNZ";
  const tableId = process.env.FEISHU_LESSON_RECORD_TABLE_ID || "";

  if (!tableId || !records.length) {
    return { configured: Boolean(tableId), written: 0 };
  }

  const token = await getFeishuToken();
  if (!token) return { configured: true, written: 0, error: "飞书应用未配置或无法获取授权" };

  const fieldsResult = await ensureLessonRecordFields(token, appToken, tableId);
  if (fieldsResult.error) {
    return { configured: true, written: 0, error: fieldsResult.error };
  }

  let written = 0;
  const chunks = chunk(records, 500);

  for (const recordsChunk of chunks) {
    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          records: recordsChunk.map((record) => ({
            fields: {
              导入月份: record.importMonth,
              教练名称: record.coachName,
              课程名称: record.courseName,
              课程类型: record.courseType,
              上课日期: record.lessonDate,
              上课时间: record.lessonTime,
              统计课时: record.duration,
              原始课时: String(record.rawDuration),
              上课地点: record.venue,
              学员: record.students,
              学员人数: String(record.studentCount),
              上课实收: String(record.revenue),
              助教: record.assistant,
              来源文件: record.sourceFile,
              sourceKey: record.sourceKey,
            },
          })),
        }),
      }
    );
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string } | null;
    if (!response.ok || payload?.code !== 0) {
      return {
        configured: true,
        written,
        error: payload?.msg || "写入飞书课时明细表失败",
      };
    }
    written += recordsChunk.length;
  }

  return { configured: true, written };
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function ensureLessonRecordFields(token: string, appToken: string, tableId: string) {
  const listResponse = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    }
  );
  const listPayload = (await listResponse.json().catch(() => null)) as
    | FeishuFieldListResponse
    | null;

  if (!listResponse.ok || listPayload?.code !== 0) {
    return { error: listPayload?.msg || "读取飞书表字段失败" };
  }

  const existing = new Set(
    (listPayload.data?.items || [])
      .map((field) => field.field_name)
      .filter(Boolean)
  );
  const missing = lessonRecordFields.filter((fieldName) => !existing.has(fieldName));

  for (const fieldName of missing) {
    const createResponse = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          field_name: fieldName,
          type: 1,
        }),
      }
    );
    const createPayload = (await createResponse.json().catch(() => null)) as
      | { code?: number; msg?: string }
      | null;

    if (!createResponse.ok || createPayload?.code !== 0) {
      return { error: createPayload?.msg || `创建飞书字段失败：${fieldName}` };
    }
  }

  return { created: missing.length };
}

export async function POST(request: Request) {
  if (!(await requireSession(request))) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "请上传 Excel 文件" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const records = parseRows(rows, file.name);
  const feishu = await writeRecordsToFeishu(records);

  return Response.json({
    ok: true,
    records,
    parsed: records.length,
    skipped: Math.max(rows.length - records.length, 0),
    feishu,
  });
}
