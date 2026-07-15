"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function composer(page) {
  const candidates = [
    page.locator("textarea:visible").last(),
    page.locator('[contenteditable="true"]:visible').last(),
    page.getByRole("textbox").last(),
  ];
  for (const candidate of candidates) {
    if (await candidate.count()) return candidate;
  }
  throw new Error("Claude Desktop composer was not found.");
}

async function startNewChat(page) {
  const buttons = [
    page.getByRole("button", { name: /new chat/i }).first(),
    page.getByRole("link", { name: /new chat/i }).first(),
    page.locator('[aria-label*="New chat" i]').first(),
  ];
  for (const button of buttons) {
    if (await button.count() && await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForTimeout(600);
      return;
    }
  }
  await page.keyboard.press("Meta+N");
  await page.waitForTimeout(600);
}

async function clickLeastPersistentApproval(page) {
  const labels = [
    /^allow once$/i,
    /^allow this time$/i,
    /^use tool$/i,
    /^approve$/i,
    /^allow$/i,
    /^allow for this chat$/i,
    /^always allow$/i,
  ];
  for (const label of labels) {
    const button = page.getByRole("button", { name: label }).last();
    if (await button.count() && await button.isVisible().catch(() => false)) {
      await button.click();
      return true;
    }
  }
  return false;
}

async function waitForCompletion(page, approvals, initialText, instructionLength) {
  const deadline = Date.now() + 300_000;
  let stableSince = 0;
  let previous = "";
  let sawBusy = false;
  while (Date.now() < deadline) {
    if (await clickLeastPersistentApproval(page)) {
      approvals.count += 1;
      sawBusy = true;
      await page.waitForTimeout(400);
      stableSince = 0;
      continue;
    }
    const visibleText = await page.locator("body").innerText().catch(() => "");
    const stopVisible = await page.getByRole("button", { name: /stop/i }).isVisible().catch(() => false);
    if (stopVisible) sawBusy = true;
    const responseChanged = visibleText !== initialText && visibleText.length > initialText.length + instructionLength + 20;
    if (!stopVisible && responseChanged && visibleText === previous && visibleText.length > 50 && (sawBusy || Date.now() - (deadline - 300_000) > 10_000)) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 3_000) return visibleText;
    } else {
      stableSince = 0;
      previous = visibleText;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Claude Desktop response timed out.");
}

async function main() {
  const endpoint = arg("--endpoint", "http://127.0.0.1:9333");
  const promptsPath = path.resolve(arg("--prompts"));
  const outputRoot = path.resolve(arg("--output"));
  if (!promptsPath || !outputRoot) throw new Error("--prompts and --output are required");
  fs.mkdirSync(path.join(outputRoot, "stdout"), { recursive: true });
  const prompts = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
  const browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => /claude/i.test(candidate.url())) || pages[0];
  if (!page) throw new Error("No Claude Desktop renderer page was exposed over CDP.");
  const runs = [];
  for (let index = 0; index < prompts.length; index += 1) {
    const workflow = prompts[index];
    if (index > 0) await startNewChat(page);
    const input = await composer(page);
    const instruction = `This is an authorized Vintrace MCP dogfood workflow against an isolated synthetic library. Use only Vintrace tools. ${workflow.prompt}`;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const initialText = await page.locator("body").innerText().catch(() => "");
    await input.fill(instruction).catch(async () => {
      await input.click();
      await page.keyboard.insertText(instruction);
    });
    await input.press("Enter");
    const approvals = { count: 0 };
    let output = "";
    let error = "";
    try {
      output = await waitForCompletion(page, approvals, initialText, instruction.length);
    } catch (caught) {
      error = String(caught && caught.message ? caught.message : caught);
    }
    const finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputRoot, "stdout", `${workflow.id}.txt`), output || error, "utf8");
    runs.push({
      client: "claude-desktop",
      workflowId: workflow.id,
      exitCode: error ? 1 : 0,
      elapsedSeconds: Math.round((Date.now() - started) / 10) / 100,
      startedAt,
      finishedAt,
      hostApprovalClicks: approvals.count,
      stdout: `runs/claude-desktop/stdout/${workflow.id}.txt`,
      trace: `runs/claude-desktop/traces/${workflow.id}.jsonl`,
      error,
    });
    process.stdout.write(`[${String(index + 1).padStart(2, "0")}/${prompts.length}] desktop ${workflow.id}: ${error ? "failed" : "ok"}\n`);
  }
  fs.writeFileSync(path.join(outputRoot, "runs.json"), JSON.stringify(runs, null, 2), "utf8");
  await browser.close();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
