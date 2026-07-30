const storageKey = "tennis-payroll-app-v1";
const cloudStateEndpoint = "/api/tennis-state";

const coachLevels = {
  junior: {
    label: "初级教练",
    privateRate: 100,
    groupRate: 100,
    sparringRate: 50,
  },
  middle: {
    label: "中级教练",
    privateRate: 115,
    groupRate: 115,
    sparringRate: 75,
  },
  senior: {
    label: "高级教练",
    privateRate: 130,
    groupRate: 130,
    sparringRate: 100,
  },
};

const courseTypes = {
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

const classTimes = ["7-9", "9-11"];
const classLevels = ["初级班", "提高班", "竞赛班"];
const courseStatuses = ["未开始", "进行中", "已结课", "停课", "退课"];
const settlementStatuses = ["未结算", "已结算"];
const weekdays = [
  ["1", "周一"],
  ["2", "周二"],
  ["3", "周三"],
  ["4", "周四"],
  ["5", "周五"],
  ["6", "周六"],
  ["0", "周日"],
];

let state = {
  importedAt: "",
  coaches: [],
  enrollments: [],
  manualHours: {},
};

let selectedEnrollmentId = "";
let isStudentModalOpen = false;
let selectedLessonIndex = 0;
let selectedSettlementEnrollmentIds = new Set();
let cloudSaveTimer = 0;
let cloudSyncEnabled = false;
let isHydratingState = true;

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0,
});

const todayMonth = () => new Date().toISOString().slice(0, 7);
const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDate = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const monthBounds = (monthValue) => {
  const [year, month] = monthValue.split("-").map(Number);
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  };
};

const readSavedState = () => {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
};

const writeSavedState = () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Some browsers restrict localStorage for file:// pages. Keep the page usable.
  }
};

const readCloudState = async () => {
  try {
    const response = await fetch(`${cloudStateEndpoint}?v=${Date.now()}`);
    if (!response.ok) return null;

    const payload = await response.json();
    cloudSyncEnabled = Boolean(payload.configured);
    return payload.state && typeof payload.state === "object" ? payload.state : null;
  } catch {
    cloudSyncEnabled = false;
    return null;
  }
};

const writeCloudState = () => {
  if (!cloudSyncEnabled || isHydratingState) return;

  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(async () => {
    try {
      await fetch(cloudStateEndpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
    } catch {
      // Local storage remains the fallback if cloud sync is temporarily unavailable.
    }
  }, 500);
};

const applySeedData = (data, saved) => {
  const hasNewImport = data.importedAt && data.importedAt !== state.importedAt;
  const shouldSeed = !saved || hasNewImport;

  if (!shouldSeed) return;
  if (data.importedAt) state.importedAt = data.importedAt;
  if (Array.isArray(data.coaches)) state.coaches = data.coaches;
  if (Array.isArray(data.enrollments)) state.enrollments = data.enrollments;
  if (data.manualHours) state.manualHours = data.manualHours;
  if (data.monthlyManualHours) state.manualHours = data.monthlyManualHours;
  saveState();
};

const loadState = async () => {
  const saved = readSavedState();
  if (saved) {
    try {
      state = { ...state, ...JSON.parse(saved) };
    } catch {
      state.importedAt = "";
    }
  }

  const cloudState = await readCloudState();
  if (cloudState) {
    state = { ...state, ...cloudState };
    writeSavedState();
    return;
  }

  const embeddedSeed = document.querySelector("#seed-data");
  if (embeddedSeed?.textContent) {
    try {
      applySeedData(JSON.parse(embeddedSeed.textContent), saved);
      return;
    } catch {
      // Fall back to loading the adjacent JSON file.
    }
  }

  try {
    const seedFile =
      window.location.protocol === "file:"
        ? "./tennis-preview-data.json"
        : "./tennis-data-2026-07-05.json";
    const response = await fetch(`${seedFile}?v=${Date.now()}`);
    if (!response.ok) return;
    const data = await response.json();
    applySeedData(data, saved);
  } catch {
    // The page still works without the seed JSON file.
  }
};

const saveState = () => {
  writeSavedState();
  writeCloudState();
};

const getCoach = (coachId) =>
  state.coaches.find((coach) => coach.id === coachId);

const getEnrollment = (enrollmentId) =>
  state.enrollments.find((enrollment) => enrollment.id === enrollmentId);

const getEnrollmentCreatedAt = (enrollment) => {
  const timestamp = String(enrollment.id || "").match(/\d+/)?.[0];
  return timestamp ? Number(timestamp) : 0;
};

const getClassTime = (enrollment) =>
  classTimes.includes(enrollment.classTime) ? enrollment.classTime : "7-9";

const getCancelClassTimeLabel = (classTime) =>
  classTime === "all" || !classTime ? "7-9、9-11" : classTime;

const getClassLevel = (enrollment) =>
  classLevels.includes(enrollment.classLevel) ? enrollment.classLevel : "提高班";

const getCourseStatus = (enrollment) => {
  if (["停课", "退课"].includes(enrollment.status)) return enrollment.status;

  const today = dateKey(new Date());
  const start = enrollment.startDate;
  const completion = getCompletionDate(enrollment);

  if (start && today < start) return "未开始";
  if (completion && today > completion) return "已结课";
  return "进行中";
};

const getSettlementStatus = (enrollment) =>
  settlementStatuses.includes(enrollment.settlementStatus)
    ? enrollment.settlementStatus
    : "未结算";

const getSettlementMonth = (enrollment) => getCompletionDate(enrollment).slice(0, 7);

const escapeAttribute = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const isInactiveCourse = (enrollment) =>
  ["停课", "退课"].includes(getCourseStatus(enrollment));

const getRemainingLessonCount = (enrollment) => {
  const today = dateKey(new Date());

  return getClassDates(enrollment).filter((date) => date >= today).length;
};

const shouldHighlightLowRemaining = (enrollment) => {
  const status = getCourseStatus(enrollment);

  if (["未开始", "已结课", "停课", "退课"].includes(status)) return false;
  return getRemainingLessonCount(enrollment) < 2;
};

const normalizeWeekdayPattern = (pattern) =>
  (pattern || "")
    .split(",")
    .filter((value) => value !== "")
    .sort((a, b) => Number(a) - Number(b))
    .join(",");

const getWeekdayPatternFromForm = (form, fallback) => {
  const selected = form.getAll("weekdays");
  return selected.length
    ? normalizeWeekdayPattern(selected.join(","))
    : normalizeWeekdayPattern(fallback);
};

const renderWeekdayPicker = (pattern) => {
  const selected = new Set((pattern || "").split(","));

  return `
    <fieldset class="weekday-field">
      <legend>上课周期</legend>
      <div class="weekday-picker">
        ${weekdays
          .map(([value, label]) => {
            const checked = selected.has(value) ? "checked" : "";
            return `<label><input name="weekdays" type="checkbox" value="${value}" ${checked} />${label}</label>`;
          })
          .join("")}
      </div>
    </fieldset>
  `;
};

const setWeekdayCheckboxes = (container, pattern) => {
  const selected = new Set((pattern || "").split(","));

  container.querySelectorAll('[name="weekdays"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
};

const emptyState = (title, text) => `
  <div class="empty-state">
    <div>
      <strong>${title}</strong>
      <p>${text}</p>
    </div>
  </div>
`;

const getClassDates = (enrollment) => {
  if (Array.isArray(enrollment.customClassDates) && enrollment.customClassDates.length) {
    return [...enrollment.customClassDates].sort();
  }

  const start = parseDate(enrollment.startDate);
  const weekdays = enrollment.weekdayPattern.split(",").map(Number);
  const skippedDates = new Set(enrollment.skippedDates || []);
  const totalLessons =
    toNumber(enrollment.totalLessons) ||
    courseTypes[enrollment.courseType]?.totalLessons ||
    weekdays.length * 4;
  const dates = [];

  for (
    let day = new Date(start), guard = 0;
    dates.length < totalLessons && guard < 120;
    day = addDays(day, 1), guard += 1
  ) {
    const key = dateKey(day);
    if (weekdays.includes(day.getDay()) && !skippedDates.has(key)) {
      dates.push(key);
    }
  }

  return dates;
};

const getNextAvailableClassDate = (enrollment, afterDate, existingDates) => {
  const pattern = normalizeWeekdayPattern(
    enrollment.weekdayPattern || courseTypes[enrollment.courseType]?.defaultPattern
  );
  const weekdaySet = new Set(pattern.split(",").map(Number));
  const blockedDates = new Set([
    ...(enrollment.skippedDates || []),
    ...existingDates,
  ]);

  for (
    let day = addDays(parseDate(afterDate), 1), guard = 0;
    guard < 180;
    day = addDays(day, 1), guard += 1
  ) {
    const key = dateKey(day);
    if (weekdaySet.has(day.getDay()) && !blockedDates.has(key)) {
      return key;
    }
  }

  return afterDate;
};

const cancelEnrollmentLesson = (enrollment, cancelDate) => {
  const currentDates = getClassDates(enrollment);
  if (!currentDates.includes(cancelDate)) return false;

  enrollment.skippedDates = Array.from(
    new Set([...(enrollment.skippedDates || []), cancelDate])
  ).sort();

  if (Array.isArray(enrollment.customClassDates) && enrollment.customClassDates.length) {
    const remainingDates = currentDates.filter((date) => date !== cancelDate);
    const nextDate = getNextAvailableClassDate(
      enrollment,
      remainingDates[remainingDates.length - 1] || cancelDate,
      remainingDates
    );
    enrollment.customClassDates = [...remainingDates, nextDate].sort();
  }

  enrollment.settlementMonth = getSettlementMonth(enrollment);
  return true;
};

const addCancellationRecord = ({
  date,
  classTime,
  reason,
  note = "",
  affectedEnrollmentIds = [],
}) => {
  state.cancellations = state.cancellations || [];
  state.cancellations.push({
    id: `cancel-${Date.now()}`,
    date,
    classTime,
    reason,
    note,
    affectedEnrollmentIds,
    createdAt: new Date().toISOString(),
  });
};

const getCompletionDate = (enrollment) => {
  const dates = getClassDates(enrollment);
  return dates[dates.length - 1] || enrollment.expectedCompletionDate || enrollment.startDate;
};

const getMonthCardCommissionByCoach = (monthValue) => {
  const { start, end } = monthBounds(monthValue);
  const result = {};

  state.enrollments.forEach((enrollment) => {
    if (isInactiveCourse(enrollment)) return;

    const completion = parseDate(getCompletionDate(enrollment));
    if (completion < start || completion > end) return;

    const course = courseTypes[enrollment.courseType];
    const commission = toNumber(enrollment.commission) || course.commission;
    result[enrollment.coachId] =
      (result[enrollment.coachId] || 0) + commission;
  });

  return result;
};

const renderStudentLessonCalendar = (dates) => {
  if (!dates.length) {
    return emptyState("暂无上课日期", "保存学员信息后会根据开课时间和周期生成课程记录。");
  }

  const dateToLesson = new Map(dates.map((date, index) => [date, index]));
  const first = parseDate(dates[0]);
  const last = parseDate(dates[dates.length - 1]);
  const months = [];

  for (
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    cursor <= last;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    months.push(new Date(cursor));
  }

  return months
    .map((monthDate) => {
      const monthValue = dateKey(monthDate).slice(0, 7);
      const { start, end } = monthBounds(monthValue);
      const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
      const cells = weekNames.map(
        (name) => `<div class="student-calendar-head">周${name}</div>`
      );

      for (let i = 0; i < start.getDay(); i += 1) {
        cells.push('<div class="student-calendar-day empty"></div>');
      }

      for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
        const key = dateKey(day);
        const lessonIndex = dateToLesson.get(key);
        const hasLesson = lessonIndex !== undefined;
        const selected = lessonIndex === selectedLessonIndex;

        cells.push(`
          <button
            class="student-calendar-day ${hasLesson ? "has-lesson" : ""} ${selected ? "selected" : ""}"
            data-calendar-date="${key}"
            ${hasLesson ? `data-select-lesson-index="${lessonIndex}"` : ""}
            type="button"
          >
            <span>${day.getDate()}</span>
            ${hasLesson ? `<strong>第 ${lessonIndex + 1} 次</strong>` : ""}
          </button>
        `);
      }

      return `
        <section class="student-calendar-month">
          <h4>${monthDate.getFullYear()} 年 ${monthDate.getMonth() + 1} 月</h4>
          <div class="student-calendar-grid">${cells.join("")}</div>
        </section>
      `;
    })
    .join("");
};

const updateCoachOptions = () => {
  const options = state.coaches
    .map((coach) => `<option value="${coach.id}">${coach.name}</option>`)
    .join("");
  document.querySelector("#manual-coach").innerHTML = options;
  document.querySelector("#enrollment-coach").innerHTML = options;

  const filter = document.querySelector("#filter-coach");
  if (filter) {
    const selected = filter.value;
    filter.innerHTML = `<option value="">全部教练</option>${options}`;
    filter.value = selected;
  }
};

const openStudentModal = (enrollmentId) => {
  selectedEnrollmentId = enrollmentId;
  selectedLessonIndex = 0;
  isStudentModalOpen = true;
  render();
};

const closeStudentModal = () => {
  isStudentModalOpen = false;
  render();
};

const getFirstAvailableLessonDate = () => {
  const today = dateKey(new Date());
  const dates = state.enrollments.flatMap(getClassDates).sort();

  return dates.find((date) => date >= today) || dates[0] || today;
};

const renderCoaches = () => {
  const target = document.querySelector("#coach-list");

  if (!state.coaches.length) {
    target.innerHTML = emptyState("暂无教练", "请先添加教练，再录入课时和报名。");
    return;
  }

  target.innerHTML = state.coaches
    .map((coach) => {
      const level = coachLevels[coach.level];
      return `
        <div class="record">
          <div>
            <strong>${coach.name}</strong>
            <small>${level.label} · 私教/班课 ${level.privateRate} 元/小时 · 陪打 ${level.sparringRate} 元/小时</small>
          </div>
          <div class="record-actions">
            <button class="danger-button" data-delete-coach="${coach.id}" type="button">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
};

const renderSalary = () => {
  const monthValue = document.querySelector("#salary-month").value;
  const monthHours = state.manualHours[monthValue] || {};
  const monthlyCardCommission = getMonthCardCommissionByCoach(monthValue);
  const completedCount = state.enrollments.filter((enrollment) => {
    if (isInactiveCourse(enrollment)) return false;

    const { start, end } = monthBounds(monthValue);
    const completion = parseDate(getCompletionDate(enrollment));
    return completion >= start && completion <= end;
  }).length;

  let salaryTotal = 0;
  let cardTotal = 0;

  document.querySelector("#salary-table").innerHTML = state.coaches
    .map((coach) => {
      const level = coachLevels[coach.level];
      const hours = monthHours[coach.id] || {};
      const privateHours = toNumber(hours.privateHours);
      const groupHours = toNumber(hours.groupHours);
      const sparringHours = toNumber(hours.sparringHours);
      const cardCommission = monthlyCardCommission[coach.id] || 0;
      const manualTotal =
        privateHours * level.privateRate +
        groupHours * level.groupRate +
        sparringHours * level.sparringRate;
      const total = manualTotal + cardCommission;

      salaryTotal += total;
      cardTotal += cardCommission;

      return `
        <tr>
          <td>${coach.name}</td>
          <td>${level.label}</td>
          <td>${privateHours} 小时 / ${currency.format(privateHours * level.privateRate)}</td>
          <td>${groupHours} 小时 / ${currency.format(groupHours * level.groupRate)}</td>
          <td>${sparringHours} 小时 / ${currency.format(sparringHours * level.sparringRate)}</td>
          <td>${currency.format(cardCommission)}</td>
          <td><strong>${currency.format(total)}</strong></td>
        </tr>
      `;
    })
    .join("");

  document.querySelector("#total-salary").textContent = currency.format(salaryTotal);
  document.querySelector("#monthly-commission").textContent = currency.format(cardTotal);
  document.querySelector("#completed-students").textContent = completedCount;
};

const renderEnrollments = () => {
  const target = document.querySelector("#enrollment-list");
  const countTarget = document.querySelector("#record-count");
  const selectAll = document.querySelector("#select-visible-enrollments");
  const selectedCountTarget = document.querySelector("#selected-settlement-count");
  const batchButton = document.querySelector("#batch-settlement-done");

  if (!state.enrollments.length) {
    if (countTarget) countTarget.textContent = "0 条";
    selectedSettlementEnrollmentIds.clear();
    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
    if (selectedCountTarget) selectedCountTarget.textContent = "已选 0 条";
    if (batchButton) batchButton.disabled = true;
    target.innerHTML = emptyState(
      "暂无报名记录",
      "录入报名后，系统会自动生成结课日期和上课日历。"
    );
    return;
  }

  const filters = {
    studentName:
      document.querySelector("#filter-student-name")?.value.trim() || "",
    coachId: document.querySelector("#filter-coach")?.value || "",
    courseStatus: document.querySelector("#filter-course-status")?.value || "",
    settlementStatus:
      document.querySelector("#filter-settlement-status")?.value || "",
    settlementMonth:
      document.querySelector("#filter-settlement-month")?.value || "",
  };
  const filtered = state.enrollments
    .filter((enrollment) => {
      if (
        filters.studentName &&
        !enrollment.studentName.includes(filters.studentName)
      ) {
        return false;
      }
      if (filters.coachId && enrollment.coachId !== filters.coachId) return false;
      if (filters.courseStatus && getCourseStatus(enrollment) !== filters.courseStatus) {
        return false;
      }
      if (
        filters.settlementStatus &&
        getSettlementStatus(enrollment) !== filters.settlementStatus
      ) {
        return false;
      }
      if (
        filters.settlementMonth &&
        getSettlementMonth(enrollment) !== filters.settlementMonth
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dateDiff = new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      if (dateDiff) return dateDiff;
      return getEnrollmentCreatedAt(b) - getEnrollmentCreatedAt(a);
    });

  if (countTarget) {
    countTarget.textContent = `${filtered.length} / ${state.enrollments.length} 条`;
  }

  const existingIds = new Set(state.enrollments.map((enrollment) => enrollment.id));
  selectedSettlementEnrollmentIds = new Set(
    [...selectedSettlementEnrollmentIds].filter((id) => existingIds.has(id))
  );

  const visibleIds = filtered.map((enrollment) => enrollment.id);
  const visibleIdSet = new Set(visibleIds);
  selectedSettlementEnrollmentIds = new Set(
    [...selectedSettlementEnrollmentIds].filter((id) => visibleIdSet.has(id))
  );
  const visibleSelectedCount = visibleIds.filter((id) =>
    selectedSettlementEnrollmentIds.has(id)
  ).length;

  if (selectAll) {
    selectAll.checked = Boolean(visibleIds.length && visibleSelectedCount === visibleIds.length);
    selectAll.indeterminate = Boolean(
      visibleSelectedCount && visibleSelectedCount < visibleIds.length
    );
    selectAll.disabled = !visibleIds.length;
  }
  if (selectedCountTarget) {
    selectedCountTarget.textContent = `已选 ${selectedSettlementEnrollmentIds.size} 条`;
  }
  if (batchButton) {
    batchButton.disabled = selectedSettlementEnrollmentIds.size === 0;
  }

  if (!filtered.length) {
    target.innerHTML = emptyState("没有匹配记录", "调整筛选条件后会显示对应报名记录。");
    return;
  }

  target.innerHTML = filtered
    .map((enrollment) => {
      const coach = getCoach(enrollment.coachId);
      const course = courseTypes[enrollment.courseType];
      const courseName = enrollment.courseName || course.label;
      const classLevel = getClassLevel(enrollment);
      const commission = toNumber(enrollment.commission) || course.commission;
      const dates = getClassDates(enrollment);
      const completion = getCompletionDate(enrollment);
      const remaining = getRemainingLessonCount(enrollment);
      const lowRemaining = shouldHighlightLowRemaining(enrollment);
      const status = getCourseStatus(enrollment);
      const settlementStatus = getSettlementStatus(enrollment);
      const settlementMonth = getSettlementMonth(enrollment) || "未设置";

      return `
        <div class="record ${enrollment.id === selectedEnrollmentId ? "selected" : ""} ${lowRemaining ? "low-remaining" : ""}">
          <label class="record-checkbox" aria-label="选择 ${enrollment.studentName}">
            <input
              name="settlementSelection"
              type="checkbox"
              value="${enrollment.id}"
              ${selectedSettlementEnrollmentIds.has(enrollment.id) ? "checked" : ""}
            />
          </label>
          <div>
            <strong>${enrollment.studentName} · ${courseName}</strong>
            <small>${coach?.name || "未指定教练"} · ${classLevel} · ${getClassTime(enrollment)} · 开课 ${enrollment.startDate} · 结课 ${completion} · 剩余 ${remaining} 次 · 共 ${dates.length} 次课 · ${status} · ${settlementStatus} · 结算月份 ${settlementMonth} · 提成 ${currency.format(commission)}</small>
            ${lowRemaining ? '<span class="warning-text">剩余不足 2 次，请关注续课或结课核对</span>' : ""}
          </div>
          <div class="record-actions">
            <span class="pill">${completion}</span>
            <button class="ghost-button" data-open-enrollment="${enrollment.id}" type="button">查看/编辑</button>
            <button class="danger-button" data-delete-enrollment="${enrollment.id}" type="button">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
};

const getLessonsForDate = (targetDate) =>
  state.enrollments
    .filter((enrollment) => !isInactiveCourse(enrollment))
    .filter((enrollment) => getClassDates(enrollment).includes(targetDate));

const renderDailySchedule = () => {
  const target = document.querySelector("#daily-schedule");
  const scheduleDate = document.querySelector("#schedule-date").value;
  const lessons = getLessonsForDate(scheduleDate);

  if (!lessons.length) {
    target.innerHTML = emptyState(
      "当天暂无课程",
      "选择其他日期，或检查学员弹窗中的上课日期是否已经排入当天。"
    );
    return;
  }

  const grouped = new Map();

  lessons.forEach((enrollment) => {
    const key = [
      getClassTime(enrollment),
      enrollment.courseType,
      getClassLevel(enrollment),
      enrollment.coachId,
      enrollment.court || "未排",
    ].join("|");

    if (!grouped.has(key)) {
      grouped.set(key, {
        classTime: getClassTime(enrollment),
        classLevel: getClassLevel(enrollment),
        courseType: enrollment.courseType,
        coachId: enrollment.coachId,
        court: enrollment.court || "未排",
        students: [],
      });
    }

    grouped.get(key).students.push(enrollment);
  });

  const rows = [...grouped.values()]
    .sort((a, b) => {
      const timeOrder = classTimes.indexOf(a.classTime) - classTimes.indexOf(b.classTime);
      if (timeOrder !== 0) return timeOrder;
      return (getCoach(a.coachId)?.name || "").localeCompare(getCoach(b.coachId)?.name || "zh");
    })
    .map((group) => {
      const coach = getCoach(group.coachId);
      const className = group.classLevel;
      const capacity = group.courseType === "tt4" ? 4 : 6;
      const enrollmentIds = group.students.map((student) => student.id).join(",");
      const studentCells = Array.from({ length: 6 }, (_, index) => {
        const student = group.students[index];
        const lowRemaining = student && shouldHighlightLowRemaining(student);
        if (index >= capacity) {
          return '<td class="unavailable-seat"><span aria-label="无座位"></span></td>';
        }

        return student
          ? `<td><button class="schedule-student ${lowRemaining ? "low-remaining-student" : ""}" data-open-enrollment="${student.id}" type="button">${student.studentName}${lowRemaining ? "<small>余&lt;2</small>" : ""}</button></td>`
          : "<td></td>";
      }).join("");

      return `
        <tr>
          <td>${group.classTime}</td>
          <td>${className}</td>
          <td>${coach?.name || "未指定"}</td>
          <td>
            <input
              class="court-input"
              data-court-enrollments="${enrollmentIds}"
              value="${escapeAttribute(group.court === "未排" ? "" : group.court)}"
              placeholder="未排"
              aria-label="编辑场地号"
            />
          </td>
          ${studentCells}
        </tr>
      `;
    })
    .join("");

  target.innerHTML = `
    <table class="schedule-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>班型</th>
          <th>带课教练</th>
          <th>场地</th>
          <th>1</th>
          <th>2</th>
          <th>3</th>
          <th>4</th>
          <th>5</th>
          <th>6</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
};

const renderStudentDetail = () => {
  const target = document.querySelector("#student-detail");
  const modal = document.querySelector("#student-modal");
  const enrollment = getEnrollment(selectedEnrollmentId);

  modal.hidden = !isStudentModalOpen;

  if (!isStudentModalOpen || !enrollment) {
    target.innerHTML = emptyState(
      "请选择学员",
      "在报名记录中点击“查看/编辑”后，可以核对每节课日期并修改资料。"
    );
    return;
  }

  document.querySelector("#student-modal-title").textContent =
    `${enrollment.studentName} · 课程记录`;

  const courseOptions = Object.entries(courseTypes)
    .map(([value, course]) => {
      const selected = value === enrollment.courseType ? "selected" : "";
      return `<option value="${value}" ${selected}>${course.label}</option>`;
    })
    .join("");
  const classLevelOptions = classLevels
    .map((level) => {
      const selected = level === getClassLevel(enrollment) ? "selected" : "";
      return `<option value="${level}" ${selected}>${level}</option>`;
    })
    .join("");
  const settlementStatusOptions = settlementStatuses
    .map((status) => {
      const selected =
        status === getSettlementStatus(enrollment) ? "selected" : "";
      return `<option value="${status}" ${selected}>${status}</option>`;
    })
    .join("");
  const coachOptions = state.coaches
    .map((coach) => {
      const selected = coach.id === enrollment.coachId ? "selected" : "";
      return `<option value="${coach.id}" ${selected}>${coach.name}</option>`;
    })
    .join("");
  const dates = getClassDates(enrollment);
  const courseStatus = getCourseStatus(enrollment);
  const settlementMonth = getSettlementMonth(enrollment);
  if (selectedLessonIndex >= dates.length) {
    selectedLessonIndex = Math.max(dates.length - 1, 0);
  }
  const selectedLessonDate = dates[selectedLessonIndex] || "";

  target.innerHTML = `
    <form id="student-edit-form" class="detail-card form-grid">
      <h3>学员信息</h3>
      <label>
        学员姓名
        <input name="studentName" required value="${enrollment.studentName}" />
      </label>
      <label>
        课程类型
        <select name="courseType" required>${courseOptions}</select>
      </label>
      <label>
        班级水平
        <select name="classLevel" required>${classLevelOptions}</select>
      </label>
      <label>
        上课教练
        <select name="coachId" required>${coachOptions}</select>
      </label>
      <label>
        开课时间
        <input name="startDate" type="date" required value="${enrollment.startDate}" />
      </label>
      <label>
        上课时间
        <select name="classTime" required>
          <option value="7-9" ${getClassTime(enrollment) === "7-9" ? "selected" : ""}>7-9</option>
          <option value="9-11" ${getClassTime(enrollment) === "9-11" ? "selected" : ""}>9-11</option>
        </select>
      </label>
      ${renderWeekdayPicker(enrollment.weekdayPattern)}
      <label>
        总课次
        <input name="totalLessons" type="number" min="1" step="1" value="${toNumber(enrollment.totalLessons) || dates.length}" />
      </label>
      <label>
        课程状态
        <span class="readonly-field">${courseStatus}</span>
      </label>
      <label>
        结算状态
        <select name="settlementStatus">${settlementStatusOptions}</select>
      </label>
      <label>
        结算月份
        <span class="readonly-field">${settlementMonth}</span>
      </label>
      <button type="submit">保存学员信息</button>
    </form>

    <form id="lesson-dates-form" class="detail-card lesson-calendar-card">
      <h3>上课记录</h3>
      <div class="lesson-editor">
        <div>
          <strong>第 ${selectedLessonIndex + 1} 次课</strong>
          <span>${selectedLessonDate || "未生成日期"}</span>
        </div>
        <label>
          修改为
          <input id="selected-lesson-date" name="selectedLessonDate" type="date" value="${selectedLessonDate}" />
        </label>
        <button type="submit">保存本次日期</button>
        <button class="danger-button" data-cancel-selected-lesson type="button" ${selectedLessonDate ? "" : "disabled"}>取消本次课</button>
      </div>
      <p class="helper-text">点亮的日期是已排课程。点击某次课选中记录，再点击普通日期可改期；也可以直接取消本次课并自动顺延。</p>
      <div class="student-lesson-calendar">
        ${renderStudentLessonCalendar(dates)}
      </div>
    </form>
  `;
};

const renderCancelHistory = () => {
  const list = document.querySelector("#cancel-history-list");
  const count = document.querySelector("#cancel-history-count");
  if (!list || !count) return;

  const cancellations = [...(state.cancellations || [])].sort((a, b) =>
    String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""))
  );

  count.textContent = `${cancellations.length} 条`;

  if (!cancellations.length) {
    list.innerHTML = emptyState("暂无取消记录", "天气或节假日取消后，会在这里留下记录。");
    return;
  }

  list.innerHTML = cancellations
    .map((item) => {
      const affectedCount = Array.isArray(item.affectedEnrollmentIds)
        ? item.affectedEnrollmentIds.length
        : 0;
      return `
        <article class="cancel-history-item">
          <div>
            <strong>${item.date || "未设置日期"} · ${getCancelClassTimeLabel(item.classTime)}</strong>
            <small>${item.reason || "未填写原因"}${item.note ? ` · ${item.note}` : ""}</small>
          </div>
          <span>${affectedCount} 节课</span>
        </article>
      `;
    })
    .join("");
};

const renderManualForm = () => {
  const monthValue = document.querySelector("#salary-month").value;
  const coachId = document.querySelector("#manual-coach").value;
  const hours = state.manualHours[monthValue]?.[coachId] || {};

  document.querySelector('[name="privateHours"]').value =
    hours.privateHours ?? 0;
  document.querySelector('[name="groupHours"]').value = hours.groupHours ?? 0;
  document.querySelector('[name="sparringHours"]').value =
    hours.sparringHours ?? 0;
};

const render = () => {
  updateCoachOptions();
  renderCoaches();
  renderManualForm();
  renderSalary();
  renderEnrollments();
  renderDailySchedule();
  renderStudentDetail();
  renderCancelHistory();
};

const bindEvents = () => {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-button")
        .forEach((item) => item.classList.remove("active"));
      document
        .querySelectorAll(".tab-panel")
        .forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document
        .querySelector(`#${button.dataset.tab}-tab`)
        .classList.add("active");
    });
  });

  document.querySelector("#salary-month").addEventListener("change", render);
  document.querySelector("#manual-coach").addEventListener("change", renderManualForm);
  document.querySelector("#schedule-date").addEventListener("change", renderDailySchedule);
  document.querySelector("#record-filters").addEventListener("change", renderEnrollments);
  document.querySelector("#record-filters").addEventListener("input", renderEnrollments);

  document
    .querySelector("#select-visible-enrollments")
    .addEventListener("change", (event) => {
      const visibleCheckboxes = document.querySelectorAll(
        '[name="settlementSelection"]'
      );
      visibleCheckboxes.forEach((checkbox) => {
        if (event.target.checked) {
          selectedSettlementEnrollmentIds.add(checkbox.value);
        } else {
          selectedSettlementEnrollmentIds.delete(checkbox.value);
        }
      });
      renderEnrollments();
    });

  document
    .querySelector("#batch-settlement-done")
    .addEventListener("click", () => {
      if (!selectedSettlementEnrollmentIds.size) return;

      state.enrollments.forEach((enrollment) => {
        if (selectedSettlementEnrollmentIds.has(enrollment.id)) {
          enrollment.settlementStatus = "已结算";
          enrollment.settlementMonth = getSettlementMonth(enrollment);
        }
      });

      selectedSettlementEnrollmentIds.clear();
      saveState();
      render();
    });

  document
    .querySelector("#batch-cancel-form")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const cancelDate = form.get("cancelDate");
      const reason = form.get("cancelReason");
      const cancelClassTime = form.get("cancelClassTime");
      const note = form.get("cancelNote").trim();
      const affected = [];

      state.enrollments.forEach((enrollment) => {
        if (isInactiveCourse(enrollment)) return;
        if (cancelClassTime !== "all" && getClassTime(enrollment) !== cancelClassTime) {
          return;
        }
        if (cancelEnrollmentLesson(enrollment, cancelDate)) {
          affected.push(enrollment);
        }
      });

      if (affected.length) {
        addCancellationRecord({
          date: cancelDate,
          classTime: cancelClassTime,
          reason,
          note,
          affectedEnrollmentIds: affected.map((enrollment) => enrollment.id),
        });
      }

      saveState();
      const result = document.querySelector("#batch-cancel-result");
      result.hidden = false;
      result.textContent = affected.length
        ? `已取消 ${cancelDate} ${getCancelClassTimeLabel(cancelClassTime)} 的 ${affected.length} 节学员课程，并自动顺延。原因：${reason}${note ? `（${note}）` : ""}`
        : `${cancelDate} ${getCancelClassTimeLabel(cancelClassTime)} 没有可取消的月卡课记录。`;
      event.currentTarget.reset();
      document.querySelector("#schedule-date").value = cancelDate;
      render();
      result.hidden = false;
    });

  document.querySelector("#coach-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.coaches.push({
      id: `coach-${Date.now()}`,
      name: form.get("name").trim(),
      level: form.get("level"),
    });
    event.currentTarget.reset();
    saveState();
    render();
  });

  document
    .querySelector("#manual-hours-form")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const monthValue = document.querySelector("#salary-month").value;
      const coachId = form.get("coachId");

      state.manualHours[monthValue] = state.manualHours[monthValue] || {};
      state.manualHours[monthValue][coachId] = {
        privateHours: toNumber(form.get("privateHours")),
        groupHours: toNumber(form.get("groupHours")),
        sparringHours: toNumber(form.get("sparringHours")),
      };

      saveState();
      render();
    });

  document
    .querySelector("#enrollment-form")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const courseType = form.get("courseType");

      state.enrollments.push({
        id: `enrollment-${Date.now()}`,
        studentName: form.get("studentName").trim(),
        courseType,
        classLevel: form.get("classLevel"),
        courseName: courseTypes[courseType].label,
        commission: courseTypes[courseType].commission,
        coachId: form.get("coachId"),
        startDate: form.get("startDate"),
        classTime: form.get("classTime"),
        settlementStatus: "未结算",
        settlementMonth: "",
        totalLessons: courseTypes[courseType].totalLessons,
        weekdayPattern: getWeekdayPatternFromForm(
          form,
          courseTypes[courseType].defaultPattern
        ),
      });

      event.currentTarget.reset();
      saveState();
      render();
    });

  document.body.addEventListener("click", (event) => {
    const actionTarget = event.target.closest(
      "[data-delete-coach], [data-delete-enrollment], [data-select-enrollment], [data-open-enrollment], [data-close-modal], [data-open-batch-cancel], [data-close-batch-cancel], [data-select-lesson-index], [data-calendar-date], [data-cancel-selected-lesson]"
    );
    const dataset = actionTarget?.dataset || {};
    const coachId = dataset.deleteCoach;
    const enrollmentId = dataset.deleteEnrollment;
    const selectedId = dataset.selectEnrollment;
    const openId = dataset.openEnrollment;
    const shouldCloseModal =
      dataset.closeModal !== undefined ||
      event.target.id === "student-modal";
    const shouldOpenBatchCancel = dataset.openBatchCancel !== undefined;
    const shouldCloseBatchCancel =
      dataset.closeBatchCancel !== undefined ||
      event.target.id === "batch-cancel-modal";
    const shouldCancelSelectedLesson = dataset.cancelSelectedLesson !== undefined;

    if (coachId) {
      state.coaches = state.coaches.filter((coach) => coach.id !== coachId);
      state.enrollments = state.enrollments.filter(
        (enrollment) => enrollment.coachId !== coachId
      );
      saveState();
      render();
    }

    if (enrollmentId) {
      const wasSelected = selectedEnrollmentId === enrollmentId;
      state.enrollments = state.enrollments.filter(
        (enrollment) => enrollment.id !== enrollmentId
      );
      if (wasSelected) {
        selectedEnrollmentId = "";
        isStudentModalOpen = false;
      }
      saveState();
      render();
    }

    if (selectedId) {
      selectedEnrollmentId = selectedId;
      render();
    }

    if (openId) {
      openStudentModal(openId);
    }

    if (shouldCloseModal) {
      closeStudentModal();
    }

    if (shouldOpenBatchCancel) {
      const form = document.querySelector("#batch-cancel-form");
      if (form && document.querySelector("#schedule-date").value) {
        form.elements.cancelDate.value = document.querySelector("#schedule-date").value;
      }
      document.querySelector("#batch-cancel-modal").hidden = false;
    }

    if (shouldCloseBatchCancel) {
      document.querySelector("#batch-cancel-modal").hidden = true;
    }

    if (dataset.selectLessonIndex !== undefined) {
      selectedLessonIndex = Number(dataset.selectLessonIndex);
      renderStudentDetail();
    }

    if (shouldCancelSelectedLesson) {
      const enrollment = getEnrollment(selectedEnrollmentId);
      if (!enrollment) return;
      const selectedDate = getClassDates(enrollment)[selectedLessonIndex];
      if (!selectedDate) return;

      if (cancelEnrollmentLesson(enrollment, selectedDate)) {
        addCancellationRecord({
          date: selectedDate,
          classTime: getClassTime(enrollment),
          reason: "单次课程取消",
          note: `${enrollment.studentName} 第 ${selectedLessonIndex + 1} 次课`,
          affectedEnrollmentIds: [enrollment.id],
        });
        saveState();
        render();
      }
    }

    if (
      dataset.calendarDate &&
      dataset.selectLessonIndex === undefined &&
      isStudentModalOpen
    ) {
      const enrollment = getEnrollment(selectedEnrollmentId);
      if (!enrollment) return;

      enrollment.customClassDates = getClassDates(enrollment).map((date, index) =>
        index === selectedLessonIndex ? dataset.calendarDate : date
      );
      saveState();
      render();
    }

  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isStudentModalOpen) {
      closeStudentModal();
    }
    if (event.key === "Escape") {
      document.querySelector("#batch-cancel-modal").hidden = true;
    }
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target.id === "student-edit-form") {
      event.preventDefault();
      const enrollment = getEnrollment(selectedEnrollmentId);
      if (!enrollment) return;

      const form = new FormData(event.target);
      const courseType = form.get("courseType");
      const courseChanged = enrollment.courseType !== courseType;

      enrollment.studentName = form.get("studentName").trim();
      enrollment.courseType = courseType;
      enrollment.classLevel = form.get("classLevel");
      enrollment.courseName = courseTypes[courseType].label;
      enrollment.commission = courseTypes[courseType].commission;
      enrollment.coachId = form.get("coachId");
      enrollment.startDate = form.get("startDate");
      enrollment.classTime = form.get("classTime");
      enrollment.weekdayPattern = getWeekdayPatternFromForm(
        form,
        courseTypes[courseType].defaultPattern
      );
      enrollment.totalLessons = toNumber(form.get("totalLessons"));
      enrollment.settlementStatus = form.get("settlementStatus");
      enrollment.settlementMonth = getSettlementMonth(enrollment);

      if (courseChanged) {
        enrollment.totalLessons = courseTypes[courseType].totalLessons;
        delete enrollment.customClassDates;
        enrollment.settlementMonth = getSettlementMonth(enrollment);
      }

      saveState();
      render();
    }

    if (event.target.id === "lesson-dates-form") {
      event.preventDefault();
      const enrollment = getEnrollment(selectedEnrollmentId);
      if (!enrollment) return;

      const form = new FormData(event.target);
      const nextDate = form.get("selectedLessonDate");
      enrollment.customClassDates = getClassDates(enrollment).map((date, index) =>
        index === selectedLessonIndex && nextDate ? nextDate : date
      );
      enrollment.totalLessons = enrollment.customClassDates.length;
      saveState();
      render();
    }
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.name === "settlementSelection") {
      if (event.target.checked) {
        selectedSettlementEnrollmentIds.add(event.target.value);
      } else {
        selectedSettlementEnrollmentIds.delete(event.target.value);
      }
      renderEnrollments();
      return;
    }

    if (event.target.dataset.courtEnrollments !== undefined) {
      const court = event.target.value.trim();
      const ids = event.target.dataset.courtEnrollments.split(",");

      state.enrollments.forEach((enrollment) => {
        if (ids.includes(enrollment.id)) {
          enrollment.court = court;
        }
      });

      saveState();
      render();
      return;
    }

    if (event.target.name !== "courseType") return;

    const form = event.target.closest("form");
    setWeekdayCheckboxes(form, courseTypes[event.target.value].defaultPattern);
  });
};

const init = async () => {
  try {
    document.querySelector("#salary-month").value = todayMonth();
    await loadState();
    document.querySelector("#schedule-date").value = getFirstAvailableLessonDate();
    bindEvents();
    isHydratingState = false;
    writeCloudState();
    render();
  } catch (error) {
    document.body.innerHTML = `
      <main class="app-shell">
        <section class="panel startup-error">
          <div class="panel-header">
            <div>
              <p class="section-label">Startup Error</p>
              <h2>页面初始化失败</h2>
            </div>
          </div>
          <div class="list-area">
            <p>请把以下错误信息发给我，我会继续修复：</p>
            <pre>${escapeAttribute(error?.message || error)}</pre>
          </div>
        </section>
      </main>
    `;
  }
};

init();
