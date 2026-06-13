#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..", "..");
const i18nPath = path.join(repoRoot, "src", "i18n.ts");
const appPath = path.join(repoRoot, "src", "App.tsx");
const source = fs.readFileSync(i18nPath, "utf8");
const appSource = fs.readFileSync(appPath, "utf8");
const checks = [];

function add(name, ok, detail, data = {}) {
  checks.push({ name, ok: Boolean(ok), detail, ...data });
}

function extractUnionKeys(typeName) {
  const match = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

function loadI18n() {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    WeakMap,
    Map,
    Set,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }
  };
  sandbox.module.exports = sandbox.exports;
  vm.runInNewContext(compiled, sandbox, { filename: i18nPath });
  return sandbox.module.exports;
}

function visibleLiteralCandidates() {
  const candidates = new Set();
  for (const match of appSource.matchAll(/(?:aria-label|title|placeholder)=["']([^"']{3,})["']/g)) {
    candidates.add(match[1]);
  }
  for (const match of appSource.matchAll(/>\s*([A-Z][A-Za-z0-9 ,.'’:/&()+-]{3,80})\s*</g)) {
    candidates.add(match[1].replace(/\s+/g, " ").trim());
  }
  return [...candidates].filter((text) => {
    if (!/[A-Za-z]/.test(text)) return false;
    if (/^(http|vintrace|rgba|rgb|sha|E-|[a-z]+:)/i.test(text)) return false;
    if (/[{}[\]<>]/.test(text)) return false;
    return true;
  }).sort();
}

const i18n = loadI18n();
const languages = (i18n.languageOptions || []).map((item) => item.code);
const nonEnglish = languages.filter((code) => code !== "en");
const translationKeys = extractUnionKeys("TranslationKey");
const messageKeys = extractUnionKeys("UiMessageKey");

add("language set", ["en", "zh", "es", "fr", "ar", "hi", "ja"].every((code) => languages.includes(code)), languages.join(", "));
add("translation keys discovered", translationKeys.length > 20, `${translationKeys.length} keys`);
add("message keys discovered", messageKeys.length > 20, `${messageKeys.length} keys`);

for (const language of languages) {
  const missing = translationKeys.filter((key) => !i18n.translate(language, key) || i18n.translate(language, key) === key);
  add(`structured translations ${language}`, missing.length === 0, missing.slice(0, 8).join(", ") || `${translationKeys.length} keys covered`, { missing });
}

for (const language of languages) {
  const missing = messageKeys.filter((key) => !i18n.formatUiMessage(language, key) || i18n.formatUiMessage(language, key) === key);
  add(`ui messages ${language}`, missing.length === 0, missing.slice(0, 8).join(", ") || `${messageKeys.length} keys covered`, { missing });
}

const criticalLiterals = [
  "Friend test mode",
  "Simple setup for a first test",
  "Download model",
  "Retry download",
  "Offline",
  "Performance center",
  "Error reports",
  "Release readiness",
  "Find people together",
  "Possible matches",
  "Copy files",
  "Move files",
  "Trash files",
  "Start camera",
  "Capture best frame"
];

for (const language of nonEnglish) {
  const untranslated = criticalLiterals.filter((text) => i18n.translateUiText(language, text) === text);
  add(`critical literals ${language}`, untranslated.length === 0, untranslated.join(", ") || "covered", { untranslated });
}

const visibleLiterals = visibleLiteralCandidates();
const uncovered = visibleLiterals.filter((text) => nonEnglish.every((language) => i18n.translateUiText(language, text) === text));
add("visible literal translation coverage", visibleLiterals.length > 100, `${visibleLiterals.length - uncovered.length}/${visibleLiterals.length} visible literals have a non-English mapping`, {
  uncovered: uncovered.slice(0, 80)
});

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  ok,
  languages,
  translationKeys: translationKeys.length,
  messageKeys: messageKeys.length,
  visibleLiteralCandidates: visibleLiterals.length,
  checks
}, null, 2));
process.exit(ok ? 0 : 1);
