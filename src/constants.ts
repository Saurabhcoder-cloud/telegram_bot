import { FilingFormConfig, LanguageCode, SubscriptionPlanId } from "./types";

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

export const STANDARD_DEDUCTION: Record<string, number> = {
  single: 13850,
  married_joint: 27700,
  married_separate: 13850,
  head_household: 20800,
  widow: 27700,
};

export const ESTIMATE_DEPENDENT_CREDIT = 2000;
export const ESTIMATE_WITHHOLDING_RATE = 0.12;

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  price: number;
  currency: string;
  labelKey: string;
  detailsKey: string;
  requiresPayment: boolean;
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "free",
    price: 0,
    currency: "USD",
    labelKey: "subscription.plan_label_free",
    detailsKey: "subscription.plan_details_free",
    requiresPayment: false,
  },
  {
    id: "standard",
    price: 9.99,
    currency: "USD",
    labelKey: "subscription.plan_label_standard",
    detailsKey: "subscription.plan_details_standard",
    requiresPayment: true,
  },
  {
    id: "pro",
    price: 19.99,
    currency: "USD",
    labelKey: "subscription.plan_label_pro",
    detailsKey: "subscription.plan_details_pro",
    requiresPayment: true,
  },
  {
    id: "premium",
    price: 24.99,
    currency: "USD",
    labelKey: "subscription.plan_label_premium",
    detailsKey: "subscription.plan_details_premium",
    requiresPayment: true,
  },
];

export const FILING_FORM_CONFIG: FilingFormConfig[] = [
  {
    id: "w2",
    field: "w2Income",
    labelKey: "filing.form_label_w2",
    ocrType: "w2",
    requiredFields: [
      { key: "employer", labelKey: "filing.form_field_employer" },
      { key: "wages", labelKey: "filing.form_field_wages", valueType: "currency" },
      { key: "fed_tax_withheld", labelKey: "filing.form_field_federal_tax_withheld", valueType: "currency" },
    ],
  },
  {
    id: "1099-int",
    field: "form1099Income",
    labelKey: "filing.form_label_1099_int",
    ocrType: "1099-int",
    requiredFields: [
      { key: "payer", labelKey: "filing.form_field_payer" },
      { key: "interest_income", labelKey: "filing.form_field_interest_income", valueType: "currency" },
    ],
  },
  {
    id: "1099-nec",
    field: "scheduleCDetails",
    labelKey: "filing.form_label_1099_nec",
    ocrType: "1099-nec",
    requiredFields: [
      { key: "payer", labelKey: "filing.form_field_payer" },
      { key: "non_employee_comp", labelKey: "filing.form_field_non_employee_comp", valueType: "currency" },
      { key: "federal_tax_withheld", labelKey: "filing.form_field_federal_tax_withheld", valueType: "currency" },
    ],
  },
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
