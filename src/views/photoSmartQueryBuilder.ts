import type {
  PhotoAlbumRules,
  PhotoSmartQueryClause,
  PhotoSmartQueryGroup,
  PhotoSmartQueryGroupOp,
  PhotoSmartQueryNode,
} from "../types";
import { combineSmartQueryWithPeople, photoAlbumRulesToSmartQuery, type PhotoAlbumPeopleQueryOptions } from "./photoSavedSearch";

export type PhotoSmartQueryValueKind = "text" | "number" | "date" | "boolean" | "select";

export interface PhotoSmartQueryOperatorDefinition {
  operator: string;
  label: string;
}

export interface PhotoSmartQueryOption {
  value: string;
  label: string;
}

export interface PhotoSmartQueryFieldDefinition {
  field: string;
  label: string;
  valueKind: PhotoSmartQueryValueKind;
  operators: PhotoSmartQueryOperatorDefinition[];
  defaultOperator: string;
  defaultValue: string | number | boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: PhotoSmartQueryOption[];
}

const TEXT_OPERATORS: PhotoSmartQueryOperatorDefinition[] = [
  { operator: "contains", label: "contains" },
  { operator: "is", label: "is" },
  { operator: "isNot", label: "is not" },
  { operator: "notContains", label: "does not contain" },
];

const EXACT_OPERATORS: PhotoSmartQueryOperatorDefinition[] = [
  { operator: "is", label: "is" },
  { operator: "isNot", label: "is not" },
];

const DATE_OPERATORS: PhotoSmartQueryOperatorDefinition[] = [
  { operator: "onOrAfter", label: "on or after" },
  { operator: "onOrBefore", label: "on or before" },
  { operator: "is", label: "is" },
  { operator: "isNot", label: "is not" },
  { operator: "greaterThan", label: "after" },
  { operator: "lessThan", label: "before" },
];

const NUMBER_OPERATORS: PhotoSmartQueryOperatorDefinition[] = [
  { operator: "atLeast", label: "at least" },
  { operator: "atMost", label: "at most" },
  { operator: "greaterThan", label: "greater than" },
  { operator: "lessThan", label: "less than" },
  { operator: "is", label: "is" },
  { operator: "isNot", label: "is not" },
];

const RECENT_OPERATORS: PhotoSmartQueryOperatorDefinition[] = [
  { operator: "withinLast", label: "within last" },
  { operator: "isNot", label: "not within last" },
];

const NEARBY_OPERATORS: PhotoSmartQueryOperatorDefinition[] = [
  { operator: "is", label: "within" },
  { operator: "isNot", label: "outside" },
];

export const PHOTO_SMART_QUERY_FIELDS: PhotoSmartQueryFieldDefinition[] = [
  { field: "query", label: "Search text", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Title, caption, person, path" },
  { field: "title", label: "Title", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Title text" },
  { field: "caption", label: "Caption", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Caption text" },
  { field: "keyword", label: "Keyword", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Keyword" },
  { field: "person", label: "Person", valueKind: "text", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: "", placeholder: "Person name" },
  { field: "group", label: "People group", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Alice & Bob or saved group id" },
  { field: "personCount", label: "Person count", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 1, min: 0, max: 100, step: 1 },
  { field: "faceCount", label: "Face count", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 1, min: 0, max: 100, step: 1 },
  { field: "matchCount", label: "Match count", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 1, min: 0, max: 100, step: 1 },
  {
    field: "status",
    label: "Review status",
    valueKind: "select",
    operators: EXACT_OPERATORS,
    defaultOperator: "is",
    defaultValue: "accepted",
    options: [
      { value: "pending", label: "Pending" },
      { value: "accepted", label: "Accepted" },
      { value: "uncertain", label: "Not sure" },
      { value: "rejected", label: "Rejected" },
    ],
  },
  {
    field: "mediaKind",
    label: "Media type",
    valueKind: "select",
    operators: EXACT_OPERATORS,
    defaultOperator: "is",
    defaultValue: "image",
    options: [
      { value: "image", label: "Images" },
      { value: "video", label: "Videos" },
      { value: "screenshot", label: "Screenshots" },
      { value: "screen_recording", label: "Screen Recordings" },
      { value: "panorama", label: "Panoramas" },
      { value: "portrait", label: "Portraits" },
      { value: "burst", label: "Bursts" },
      { value: "time_lapse", label: "Time-lapse" },
      { value: "raw", label: "RAW" },
      { value: "live_photo", label: "Live Photos" },
      { value: "other", label: "Other" },
    ],
  },
  { field: "album", label: "Album", valueKind: "text", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: "", placeholder: "Album id" },
  { field: "notInAlbum", label: "Not in any album", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "favorite", label: "Favorite", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "rating", label: "Rating", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 3, min: 0, max: 5, step: 1 },
  {
    field: "colorLabel",
    label: "Color label",
    valueKind: "select",
    operators: EXACT_OPERATORS,
    defaultOperator: "is",
    defaultValue: "red",
    options: [
      { value: "unlabeled", label: "Unlabeled" },
      { value: "red", label: "Red" },
      { value: "yellow", label: "Yellow" },
      { value: "green", label: "Green" },
      { value: "blue", label: "Blue" },
      { value: "purple", label: "Purple" },
    ],
  },
  {
    field: "pickStatus",
    label: "Pick status",
    valueKind: "select",
    operators: EXACT_OPERATORS,
    defaultOperator: "is",
    defaultValue: "pick",
    options: [
      { value: "unflagged", label: "Unflagged" },
      { value: "pick", label: "Pick" },
      { value: "reject", label: "Reject" },
    ],
  },
  { field: "edited", label: "Edited", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "hidden", label: "Hidden", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "deleted", label: "Recently Deleted", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "duplicate", label: "Duplicate", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "unknown", label: "Unknown person", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "hasVideoFrames", label: "Has video frames", valueKind: "boolean", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: true },
  { field: "date", label: "Capture date", valueKind: "date", operators: DATE_OPERATORS, defaultOperator: "onOrAfter", defaultValue: "" },
  { field: "addedDate", label: "Added date", valueKind: "date", operators: DATE_OPERATORS, defaultOperator: "onOrAfter", defaultValue: "" },
  { field: "recentDays", label: "Recent days", valueKind: "number", operators: RECENT_OPERATORS, defaultOperator: "withinLast", defaultValue: 30, min: 1, max: 3650, step: 1 },
  { field: "folder", label: "Folder", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Path contains" },
  { field: "path", label: "Full path", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Path text" },
  { field: "filename", label: "Filename", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "File name" },
  { field: "fileType", label: "File type", valueKind: "text", operators: EXACT_OPERATORS, defaultOperator: "is", defaultValue: "", placeholder: "jpg, png, heic" },
  { field: "location", label: "Location", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Place or GPS text" },
  { field: "nearby", label: "Nearby radius", valueKind: "text", operators: NEARBY_OPERATORS, defaultOperator: "is", defaultValue: "", placeholder: "37.7749,-122.4194,25" },
  { field: "iptcCreator", label: "IPTC creator / credit", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Creator, credit, source" },
  { field: "iptcRights", label: "IPTC rights / usage", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Copyright or usage terms" },
  { field: "iptcEvent", label: "IPTC event / job", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Event, headline, job id" },
  { field: "iptcLocation", label: "IPTC location", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "City, country, sublocation" },
  { field: "camera", label: "Camera", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Make or model" },
  { field: "lens", label: "Lens", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Lens model" },
  { field: "dimensions", label: "Dimensions", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "4000x3000" },
  { field: "width", label: "Width", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 1000, min: 0, max: 200000, step: 1 },
  { field: "height", label: "Height", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 1000, min: 0, max: 200000, step: 1 },
  { field: "megapixels", label: "Megapixels", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 12, min: 0, max: 1000, step: 0.1 },
  { field: "duration", label: "Duration (sec)", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 5, min: 0, max: 86400, step: 0.1 },
  { field: "durationMs", label: "Duration (ms)", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 1000, min: 0, max: 86400000, step: 100 },
  { field: "ocrText", label: "Detected text", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "OCR or Live Text" },
  { field: "detectedItem", label: "Detected item", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Object or label" },
  { field: "modelTag", label: "Model tag", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Local tag" },
  { field: "sceneTag", label: "Scene tag", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Scene label" },
  { field: "detectedEvent", label: "Detected event", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Event label" },
  { field: "imageDescription", label: "Image description", valueKind: "text", operators: TEXT_OPERATORS, defaultOperator: "contains", defaultValue: "", placeholder: "Accessible description" },
  { field: "ocrConfidence", label: "Text confidence", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 0.8, min: 0, max: 1, step: 0.01 },
  { field: "detectedItemConfidence", label: "Detected item confidence", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 0.8, min: 0, max: 1, step: 0.01 },
  { field: "detectedEventConfidence", label: "Detected event confidence", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 0.8, min: 0, max: 1, step: 0.01 },
  { field: "modelConfidence", label: "Model confidence", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 0.8, min: 0, max: 1, step: 0.01 },
  { field: "score", label: "Match score", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 0.8, min: 0, max: 1, step: 0.01 },
  { field: "quality", label: "Face quality", valueKind: "number", operators: NUMBER_OPERATORS, defaultOperator: "atLeast", defaultValue: 0.7, min: 0, max: 1, step: 0.01 },
];

const FIELD_DEFINITIONS = new Map(PHOTO_SMART_QUERY_FIELDS.map((definition) => [definition.field, definition]));

const LEGACY_RULE_KEYS: Array<keyof PhotoAlbumRules> = [
  "statuses",
  "mediaKind",
  "query",
  "keyword",
  "dateFrom",
  "dateTo",
  "folder",
  "minScore",
  "minQuality",
  "favoriteOnly",
  "editedOnly",
  "hasVideoFrames",
  "unknownOnly",
  "recentDays",
];

export function smartQueryFieldDefinition(field: string): PhotoSmartQueryFieldDefinition {
  return FIELD_DEFINITIONS.get(field) || PHOTO_SMART_QUERY_FIELDS[0];
}

export function smartQueryRuleTemplate(field = "query"): PhotoSmartQueryClause {
  const definition = smartQueryFieldDefinition(field);
  return {
    field: definition.field,
    operator: definition.defaultOperator,
    value: definition.defaultValue,
  };
}

export function smartQueryGroupTemplate(): PhotoSmartQueryGroup {
  return { op: "all", conditions: [smartQueryRuleTemplate()] };
}

export function isPhotoSmartQueryGroup(value: PhotoSmartQueryNode | null | undefined): value is PhotoSmartQueryGroup {
  return Boolean(value && typeof value === "object" && "conditions" in value && Array.isArray((value as PhotoSmartQueryGroup).conditions));
}

export function isPhotoSmartQueryClause(value: PhotoSmartQueryNode | null | undefined): value is PhotoSmartQueryClause {
  return Boolean(value && typeof value === "object" && "field" in value && !("conditions" in value));
}

export function smartQueryGroupFromAlbumRules(
  rules: PhotoAlbumRules,
  peopleOptions: PhotoAlbumPeopleQueryOptions = {}
): PhotoSmartQueryGroup {
  const raw = rules.op && Array.isArray(rules.conditions)
    ? { op: rules.op, conditions: rules.conditions }
    : rules.queryDsl || photoAlbumRulesToSmartQuery(rules);
  const normalized = normalizeSmartQueryGroup(raw, { allowEmpty: false });
  return normalizeSmartQueryGroup(combineSmartQueryWithPeople(normalized, peopleOptions), { allowEmpty: false }) || smartQueryGroupTemplate();
}

export function albumRulesHaveLegacyCriteria(rules: PhotoAlbumRules): boolean {
  return LEGACY_RULE_KEYS.some((key) => {
    const value = rules[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return Boolean(value.trim());
    if (typeof value === "number") return value > 0;
    return Boolean(value);
  });
}

export function albumRulesHaveSmartQuery(rules: PhotoAlbumRules): boolean {
  return Boolean(
    (rules.queryDsl?.op && Array.isArray(rules.queryDsl.conditions))
    || (rules.op && Array.isArray(rules.conditions))
  );
}

export function smartQueryAlbumRules(group: PhotoSmartQueryGroup): PhotoAlbumRules {
  const normalized = normalizeSmartQueryGroup(group, { allowEmpty: false });
  if (!normalized) return {};
  return {
    op: normalized.op,
    conditions: normalized.conditions,
  };
}

export function smartQueryBuilderHasConditions(group: PhotoSmartQueryGroup): boolean {
  return Boolean(normalizeSmartQueryGroup(group, { allowEmpty: false })?.conditions.length);
}

export function normalizeSmartQueryGroup(
  value: unknown,
  options: { allowEmpty?: boolean } = {}
): PhotoSmartQueryGroup | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PhotoSmartQueryGroup>;
  const op: PhotoSmartQueryGroupOp = raw.op === "any" ? "any" : "all";
  const rawConditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const conditions = rawConditions
    .map((item) => normalizeSmartQueryNode(item))
    .filter((item): item is PhotoSmartQueryNode => Boolean(item));
  if (!conditions.length && !options.allowEmpty) return null;
  return { op, conditions };
}

export function updateSmartQueryGroupAtPath(
  group: PhotoSmartQueryGroup,
  path: number[],
  updater: (value: PhotoSmartQueryGroup) => PhotoSmartQueryGroup
): PhotoSmartQueryGroup {
  if (!path.length) return updater(group);
  const [index, ...rest] = path;
  return {
    ...group,
    conditions: group.conditions.map((condition, conditionIndex) => {
      if (conditionIndex !== index || !isPhotoSmartQueryGroup(condition)) return condition;
      return updateSmartQueryGroupAtPath(condition, rest, updater);
    }),
  };
}

export function updateSmartQueryClauseAtPath(
  group: PhotoSmartQueryGroup,
  path: number[],
  updater: (value: PhotoSmartQueryClause) => PhotoSmartQueryClause
): PhotoSmartQueryGroup {
  if (!path.length) return group;
  const [index, ...rest] = path;
  return {
    ...group,
    conditions: group.conditions.map((condition, conditionIndex) => {
      if (conditionIndex !== index) return condition;
      if (rest.length && isPhotoSmartQueryGroup(condition)) {
        return updateSmartQueryClauseAtPath(condition, rest, updater);
      }
      return !rest.length && isPhotoSmartQueryClause(condition) ? updater(condition) : condition;
    }),
  };
}

export function addSmartQueryRuleAtPath(group: PhotoSmartQueryGroup, path: number[]): PhotoSmartQueryGroup {
  return updateSmartQueryGroupAtPath(group, path, (target) => ({
    ...target,
    conditions: [...target.conditions, smartQueryRuleTemplate()],
  }));
}

export function addSmartQueryGroupAtPath(group: PhotoSmartQueryGroup, path: number[]): PhotoSmartQueryGroup {
  return updateSmartQueryGroupAtPath(group, path, (target) => ({
    ...target,
    conditions: [...target.conditions, smartQueryGroupTemplate()],
  }));
}

export function removeSmartQueryNodeAtPath(group: PhotoSmartQueryGroup, path: number[]): PhotoSmartQueryGroup {
  if (!path.length) return group;
  const [index, ...rest] = path;
  if (!rest.length) {
    return {
      ...group,
      conditions: group.conditions.filter((_, conditionIndex) => conditionIndex !== index),
    };
  }
  return {
    ...group,
    conditions: group.conditions.map((condition, conditionIndex) => {
      if (conditionIndex !== index || !isPhotoSmartQueryGroup(condition)) return condition;
      return removeSmartQueryNodeAtPath(condition, rest);
    }),
  };
}

export function setSmartQueryRuleField(clause: PhotoSmartQueryClause, field: string): PhotoSmartQueryClause {
  const definition = smartQueryFieldDefinition(field);
  return {
    field: definition.field,
    operator: definition.defaultOperator,
    value: definition.defaultValue,
  };
}

export function setSmartQueryRuleOperator(clause: PhotoSmartQueryClause, operator: string): PhotoSmartQueryClause {
  const definition = smartQueryFieldDefinition(clause.field);
  const allowed = definition.operators.some((item) => item.operator === operator) ? operator : definition.defaultOperator;
  return {
    ...clause,
    operator: allowed,
  };
}

export function setSmartQueryRuleValue(clause: PhotoSmartQueryClause, value: string | number | boolean): PhotoSmartQueryClause {
  return {
    ...clause,
    value: normalizeSmartQueryValue(smartQueryFieldDefinition(clause.field), value, { keepEmpty: true }) ?? "",
  };
}

function normalizeSmartQueryNode(value: unknown): PhotoSmartQueryNode | null {
  const group = normalizeSmartQueryGroup(value);
  if (group) return group;
  return normalizeSmartQueryClause(value);
}

function normalizeSmartQueryClause(value: unknown): PhotoSmartQueryClause | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PhotoSmartQueryClause>;
  const definition = smartQueryFieldDefinition(String(raw.field || ""));
  if (definition.field !== raw.field) return null;
  const operator = definition.operators.some((item) => item.operator === raw.operator) ? String(raw.operator) : definition.defaultOperator;
  const normalizedValue = normalizeSmartQueryValue(definition, raw.value);
  if (normalizedValue === "" || normalizedValue === null) return null;
  return {
    field: definition.field,
    operator,
    value: normalizedValue,
  };
}

function normalizeSmartQueryValue(
  definition: PhotoSmartQueryFieldDefinition,
  value: unknown,
  options: { keepEmpty?: boolean } = {}
): string | number | boolean | null {
  if (definition.valueKind === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value ?? "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return true;
    if (["0", "false", "no", "off"].includes(text)) return false;
    return Boolean(definition.defaultValue);
  }
  if (definition.valueKind === "number") {
    const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
    if (!Number.isFinite(parsed)) return options.keepEmpty ? "" : null;
    const min = typeof definition.min === "number" ? definition.min : Number.NEGATIVE_INFINITY;
    const max = typeof definition.max === "number" ? definition.max : Number.POSITIVE_INFINITY;
    return Math.max(min, Math.min(max, parsed));
  }
  if (definition.valueKind === "date") {
    const text = String(value ?? "").trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return options.keepEmpty ? "" : null;
  }
  const text = String(value ?? "").trim();
  if (definition.valueKind === "select" && definition.options?.length) {
    if (definition.options.some((option) => option.value === text)) return text;
    return String(definition.defaultValue || definition.options[0]?.value || "");
  }
  if (!text) return options.keepEmpty ? "" : null;
  return text.slice(0, 300);
}
