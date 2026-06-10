const expected = process.argv[2];

if (!expected) {
  console.error("Expected platform argument is required.");
  process.exit(1);
}

if (process.platform !== expected) {
  const labels = {
    darwin: "macOS",
    win32: "Windows",
    linux: "Linux"
  };
  console.error(
    `This package target must be built on ${labels[expected] || expected}. Current platform is ${labels[process.platform] || process.platform}.`
  );
  process.exit(1);
}

