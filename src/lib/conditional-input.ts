import { z } from "zod";
import { stepTitleSchema } from "./input";
export const comparisonSchema = z.object({
  variableKey: z.string().regex(/^org\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/),
  operator: z.enum(["equals", "not_equals"]),
  value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
}).strict();
export const containerSchema = {
  parentBranchId: z.uuid().nullable().optional(),
  anchorItemId: z.uuid().nullable().optional(),
  placement: z.enum(["start", "end", "before", "after"]).nullable().optional(),
};
export const groupCreateSchema = z.object({ title: stepTitleSchema, condition: comparisonSchema, ...containerSchema }).strict();
export const groupChangeSchema = z.object({
  title: stepTitleSchema.optional(), branchOrder: z.array(z.uuid()).min(1).max(1000).optional(), expectedVersion: z.int().min(1),
}).strict().refine((value) => value.title !== undefined || value.branchOrder !== undefined);
export const branchChangeSchema = z.object({ condition: comparisonSchema.nullable(), expectedVersion: z.int().min(1) }).strict();
export const deleteGroupSchema = z.object({ expectedVersion: z.int().min(1) }).strict();
