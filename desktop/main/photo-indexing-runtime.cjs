"use strict";

function normalizePhotoIndexingPowerMode(value) {
  const mode = String(value || "balanced").trim().toLowerCase();
  return mode === "low" || mode === "performance" || mode === "balanced" ? mode : "balanced";
}

function photoIndexingMaxCostClass(powerMode, power, options = {}) {
  let maxCostClass = powerMode === "low" ? "light" : powerMode === "balanced" ? "medium" : "heavy";
  const constraints = [];
  if (power.thermalState === "serious" || power.thermalState === "critical") {
    maxCostClass = "light";
    constraints.push(`thermal-${power.thermalState}`);
  } else if (power.thermalState === "fair" && maxCostClass === "heavy") {
    maxCostClass = "medium";
    constraints.push("thermal-fair");
  }
  if (power.speedLimit <= 60) {
    maxCostClass = "light";
    constraints.push("speed-limit-critical");
  } else if (power.speedLimit < 90 && maxCostClass === "heavy") {
    maxCostClass = "medium";
    constraints.push("speed-limit-reduced");
  }
  if (power.memoryPressure === "critical") {
    maxCostClass = "light";
    constraints.push("memory-critical");
  } else if (power.memoryPressure === "pressured" && maxCostClass === "heavy") {
    maxCostClass = "medium";
    constraints.push("memory-pressured");
  }
  if (power.onBattery && maxCostClass === "heavy" && !options.allowHeavyOnBattery) {
    maxCostClass = "medium";
    constraints.push("battery-heavy-deferred");
  }
  return { maxCostClass, constraints };
}

function derivePhotoIndexingRuntimePolicy(localSettings, rawPower, options = {}) {
  const settings = localSettings && typeof localSettings === "object" ? localSettings : {};
  const powerMode = normalizePhotoIndexingPowerMode(settings.indexingPowerMode);
  const power = rawPower && typeof rawPower === "object" ? rawPower : {};
  if (!settings.localIntelligenceEnabled) {
    return { allowed: false, reason: "local-intelligence-disabled", powerMode, maxCostClass: "none", constraints: [], ...power };
  }
  if (settings.backgroundIndexingAutoRun === false) {
    return { allowed: false, reason: "auto-run-off", powerMode, maxCostClass: "none", constraints: [], ...power };
  }
  if (settings.backgroundIndexingPaused) {
    return { allowed: false, reason: "paused", powerMode, maxCostClass: "none", constraints: [], ...power };
  }
  if (options.ignoreRuntimePolicy) {
    return { allowed: true, reason: "runtime-policy-ignored", powerMode, maxCostClass: "heavy", constraints: [], ...power };
  }
  if (power.onBattery && powerMode !== "performance" && !options.allowBattery) {
    return { allowed: false, reason: "battery", powerMode, maxCostClass: "none", constraints: ["battery"], ...power };
  }
  if (powerMode === "low" && power.idleState !== "idle" && power.idleState !== "locked" && !options.allowActiveLowPower) {
    return { allowed: false, reason: "active-low-power", powerMode, maxCostClass: "none", constraints: ["active-low-power"], ...power };
  }
  if (
    powerMode === "balanced"
    && power.foregroundActive
    && power.idleState !== "idle"
    && power.idleState !== "locked"
    && !options.allowActiveBalanced
  ) {
    return { allowed: false, reason: "foreground-active", powerMode, maxCostClass: "none", constraints: ["foreground-active"], ...power };
  }
  const costPolicy = photoIndexingMaxCostClass(powerMode, power, options);
  return {
    allowed: true,
    reason: costPolicy.constraints.length ? "allowed-constrained" : "allowed",
    powerMode,
    ...costPolicy,
    ...power,
  };
}

module.exports = {
  derivePhotoIndexingRuntimePolicy,
  normalizePhotoIndexingPowerMode,
  photoIndexingMaxCostClass,
};
