import { userSchema as coreUserSchema } from "better-auth/db";
import { z } from "zod";

type UserShape = Record<string, z.ZodType>;
type FieldType = "string" | "number" | "boolean";
type CoreField = keyof typeof coreUserSchema.shape;

type UnwrapOptional<Field> =
  Field extends z.ZodOptional<infer Inner> ? Inner : Field;

type ScalarKind<Field> = Field extends { _zod: { def: { type: infer Kind } } }
  ? Extract<Kind, FieldType>
  : never;

type AdditionalFields<Shape extends UserShape> = {
  [Key in Exclude<keyof Shape, CoreField>]: {
    type: ScalarKind<UnwrapOptional<Shape[Key]>>;
    required: Shape[Key] extends z.ZodOptional ? false : true;
    validator: { input: Shape[Key] };
  };
};

/** Derive Better Auth configuration for scalar Zod claims and their optional forms. */
export function zodUserSchemaToBetterAuthUserSpec<Shape extends UserShape>(
  schema: z.ZodObject<Shape>,
): { additionalFields: AdditionalFields<Shape> };
export function zodUserSchemaToBetterAuthUserSpec(
  schema: z.ZodObject<UserShape>,
) {
  const fields = Object.entries(schema.shape)
    .filter(([name]) => !Object.hasOwn(coreUserSchema.shape, name))
    .map(([name, field]) => {
      const optional = field instanceof z.ZodOptional;
      const { type } = (optional ? field.unwrap() : field)._zod.def;
      if (type !== "string" && type !== "number" && type !== "boolean") {
        throw new Error(
          `Unsupported Better Auth user field "${name}": ${type}`,
        );
      }

      return [
        name,
        { type, required: !optional, validator: { input: field } },
      ] as const;
    });

  return { additionalFields: Object.fromEntries(fields) };
}
