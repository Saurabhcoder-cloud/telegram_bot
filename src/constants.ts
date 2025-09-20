import { LanguageCode } from "./types";

export const FILING_STATUSES = [
  { value: "single", labelKey: "Single" },
  { value: "married_joint", labelKey: "Married Filing Jointly" },
  { value: "married_separate", labelKey: "Married Filing Separately" },
  { value: "head_household", labelKey: "Head of Household" },
  { value: "widow", labelKey: "Qualifying Widow(er)" },
];

export const INCOME_TYPES = [
  { value: "w2", labelKey: "W-2" },
  { value: "1099", labelKey: "1099" },
  { value: "student", labelKey: "Student" },
  { value: "retired", labelKey: "Retired" },
  { value: "other", labelKey: "Other" },
];

export const REMINDER_TYPES = [
  { value: "filing_deadline", labelKey: "Federal filing deadline" },
  { value: "state_deadline", labelKey: "State filing deadline" },
  { value: "documents", labelKey: "Upload missing documents" },
  { value: "payment_due", labelKey: "Tax payment due" },
];

export function formatOptionLabel(language: LanguageCode, option: { value: string; labelKey: string }): string {
  switch (language) {
    case "es":
      if (option.value === "single") return "Soltero/a";
      if (option.value === "married_joint") return "Casado declaración conjunta";
      if (option.value === "married_separate") return "Casado declaración separada";
      if (option.value === "head_household") return "Cabeza de familia";
      if (option.value === "widow") return "Viudo calificado";
      if (option.value === "w2") return "W-2";
      if (option.value === "1099") return "1099";
      if (option.value === "student") return "Estudiante";
      if (option.value === "retired") return "Jubilado";
      if (option.value === "other") return "Otro";
      if (option.value === "filing_deadline") return "Fecha límite federal";
      if (option.value === "state_deadline") return "Fecha límite estatal";
      if (option.value === "documents") return "Subir documentos";
      if (option.value === "payment_due") return "Pago pendiente";
      break;
    case "ru":
      if (option.value === "single") return "Холост/незамужем";
      if (option.value === "married_joint") return "Женатые совместно";
      if (option.value === "married_separate") return "Женатые раздельно";
      if (option.value === "head_household") return "Глава семьи";
      if (option.value === "widow") return "Вдовец/вдова";
      if (option.value === "student") return "Студент";
      if (option.value === "retired") return "Пенсионер";
      if (option.value === "other") return "Другое";
      if (option.value === "filing_deadline") return "Федеральный дедлайн";
      if (option.value === "state_deadline") return "Дедлайн штата";
      if (option.value === "documents") return "Загрузить документы";
      if (option.value === "payment_due") return "Оплата налога";
      break;
    case "zh":
      if (option.value === "single") return "单身";
      if (option.value === "married_joint") return "夫妻共同申报";
      if (option.value === "married_separate") return "夫妻分别申报";
      if (option.value === "head_household") return "户主";
      if (option.value === "widow") return "符合条件的鳏寡";
      if (option.value === "student") return "学生";
      if (option.value === "retired") return "退休";
      if (option.value === "other") return "其他";
      if (option.value === "filing_deadline") return "联邦截止日期";
      if (option.value === "state_deadline") return "州截止日期";
      if (option.value === "documents") return "上传缺少的文件";
      if (option.value === "payment_due") return "待付款";
      break;
    case "ar":
      if (option.value === "single") return "أعزب";
      if (option.value === "married_joint") return "متزوج - إقرار مشترك";
      if (option.value === "married_separate") return "متزوج - إقرار منفصل";
      if (option.value === "head_household") return "رب الأسرة";
      if (option.value === "widow") return "أرمل مؤهل";
      if (option.value === "student") return "طالب";
      if (option.value === "retired") return "متقاعد";
      if (option.value === "other") return "أخرى";
      if (option.value === "filing_deadline") return "الموعد النهائي الفيدرالي";
      if (option.value === "state_deadline") return "الموعد النهائي للولاية";
      if (option.value === "documents") return "رفع المستندات";
      if (option.value === "payment_due") return "دفع مستحق";
      break;
    case "fa":
      if (option.value === "single") return "مجرد";
      if (option.value === "married_joint") return "متأهل - اظهار مشترک";
      if (option.value === "married_separate") return "متأهل - اظهار جداگانه";
      if (option.value === "head_household") return "سرپرست خانوار";
      if (option.value === "widow") return "بیوه واجد شرایط";
      if (option.value === "student") return "دانشجو";
      if (option.value === "retired") return "بازنشسته";
      if (option.value === "other") return "سایر";
      if (option.value === "filing_deadline") return "موعد فدرال";
      if (option.value === "state_deadline") return "موعد ایالت";
      if (option.value === "documents") return "بارگذاری مدارک";
      if (option.value === "payment_due") return "پرداخت";
      break;
  }
  return option.labelKey;
}

export function formatStatus(language: LanguageCode, status: string): string {
  const key = status.toLowerCase();
  switch (language) {
    case "es":
      if (key === "draft") return "borrador";
      if (key === "submitted") return "enviado";
      if (key === "completed") return "completado";
      break;
    case "ru":
      if (key === "draft") return "черновик";
      if (key === "submitted") return "отправлено";
      if (key === "completed") return "готово";
      break;
    case "zh":
      if (key === "draft") return "草稿";
      if (key === "submitted") return "已提交";
      if (key === "completed") return "已完成";
      break;
    case "ar":
      if (key === "draft") return "مسودة";
      if (key === "submitted") return "مُرسل";
      if (key === "completed") return "مكتمل";
      break;
    case "fa":
      if (key === "draft") return "پیش‌نویس";
      if (key === "submitted") return "ارسال شده";
      if (key === "completed") return "تکمیل شده";
      break;
  }
  return status;
}
