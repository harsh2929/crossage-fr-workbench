import type { PhotoEditStackValue } from "../types";
import { normalizePhotoImageEditOperation, photoEditStackOperationLabel, type PhotoImageEditOperation } from "./photoImageEdits";

export function photoCssBackgroundImage(url: string): string {
  const clean = String(url || "").replace(/["\\\n\r]/g, "");
  return clean ? `url("${clean}")` : "";
}

export function photoEditStackImageOperationFromValue(value: PhotoEditStackValue | null | undefined): PhotoImageEditOperation | null {
  const nestedStack = value?.hasStack && value.stack && typeof value.stack === "object"
    ? value.stack as Partial<PhotoEditStackValue>
    : null;
  const stack = nestedStack || value;
  const operations = Array.isArray(stack?.operations) ? stack.operations : [];
  return operations
    .map((operation) => normalizePhotoImageEditOperation(operation))
    .find((operation): operation is PhotoImageEditOperation => Boolean(operation)) || null;
}

export function photoEditStackGeneratedOperationFromValue(value: PhotoEditStackValue | null | undefined): Record<string, unknown> | null {
  const nestedStack = value?.hasStack && value.stack && typeof value.stack === "object"
    ? value.stack as Partial<PhotoEditStackValue>
    : null;
  const operations = Array.isArray((nestedStack || value)?.operations) ? (nestedStack || value)?.operations || [] : [];
  return operations.find((operation) => String(operation?.kind || "").trim().toLowerCase() === "local_generative_edit") || null;
}

export function photoEditOperationsWithGeneratedBase(
  value: PhotoEditStackValue | null | undefined,
  operation: object,
): Array<Record<string, unknown>> {
  const generated = photoEditStackGeneratedOperationFromValue(value);
  const normalizedOperation = { ...operation } as Record<string, unknown>;
  return generated ? [generated, normalizedOperation] : [normalizedOperation];
}

export function photoRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function photoEditStackVersionOperationLabel(operations: Record<string, unknown>[]): string {
  return photoEditStackOperationLabel(operations);
}

export function compactPhotoEditStackId(value: unknown): string {
  const text = String(value || "").trim();
  if (text.length <= 14) return text;
  return `...${text.slice(-10)}`;
}
