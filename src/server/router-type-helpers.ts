import type { AnyProcedure } from "@orpc/server";

export type ProcedureNames<Router> = {
  [Key in keyof Router & string]: Router[Key] extends AnyProcedure
    ? Key
    : Router[Key] extends object
      ? `${Key}.${ProcedureNames<Router[Key]>}`
      : never;
}[keyof Router & string];
