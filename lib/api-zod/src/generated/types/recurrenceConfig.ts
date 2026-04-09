export type RecurrenceType = "daily" | "weekly" | "monthly" | "yearly" | "periodic" | "custom";

export interface RecurrenceConfig {
  type: RecurrenceType;
  weekDays?: number[];
  monthlyMode?: "ordinal" | "day";
  ordinalWeek?: number;
  ordinalDay?: number;
  monthDay?: number;
  intervalDays?: number;
  customInterval?: number;
  customUnit?: "day" | "week" | "month" | "year";
  customWeekDays?: number[];
}
