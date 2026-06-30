"use strict";

const assert = require("assert");
const path = require("path");

const { parseProtocolUrl } = require("../desktop/main/external-open.cjs");

function resolved(value) {
  return path.resolve(value);
}

function testExistingProtocolRoutesRemainUnchanged() {
  assert.deepStrictEqual(parseProtocolUrl("vintrace://workspace?path=/tmp/app"), {
    type: "workspace",
    path: resolved("/tmp/app"),
    source: "protocol",
  });
  assert.deepStrictEqual(parseProtocolUrl("vintrace://scan?folder=/tmp/photos"), {
    type: "scan-folder",
    path: resolved("/tmp/photos"),
    source: "protocol",
  });
  assert.deepStrictEqual(parseProtocolUrl("vintrace://watch?path=/tmp/watch"), {
    type: "watch-folder",
    path: resolved("/tmp/watch"),
    source: "protocol",
  });
}

function testPhotosImportProtocolParsesRepeatedLocalPaths() {
  const payload = parseProtocolUrl(
    "vintrace://photos-import"
    + "?path=/tmp/camera/DCIM"
    + "&file=/tmp/export/one.jpg"
    + "&paths=/tmp/export/two.heic"
    + "&folder=/tmp/shared"
    + "&sourceKind=camera"
    + "&sourceLabel=Card%20Reader"
    + "&sourceDetail=Opened%20from%20Finder"
  );
  assert.deepStrictEqual(payload, {
    type: "photos-import",
    paths: [
      resolved("/tmp/export/two.heic"),
      resolved("/tmp/camera/DCIM"),
      resolved("/tmp/export/one.jpg"),
      resolved("/tmp/shared"),
    ],
    source: "protocol",
    sourceKind: "camera",
    sourceLabel: "Card Reader",
    sourceDetail: "Opened from Finder",
  });
}

function testPhotosImportRejectsUnknownSourceKindAndDedupes() {
  const payload = parseProtocolUrl("vintrace://import-photos?file=/tmp/a.jpg&path=/tmp/a.jpg&sourceKind=banana");
  assert.deepStrictEqual(payload, {
    type: "photos-import",
    paths: [resolved("/tmp/a.jpg")],
    source: "protocol",
  });
}

function testPhotosImportBuildsSourceDetailFromAppAliases() {
  const payload = parseProtocolUrl(
    "vintrace://photos-import"
    + "?file=/tmp/mail/photo.jpg"
    + "&source=mail"
    + "&appName=Mail"
    + "&sender=taylor%40example.test"
    + "&sourceUrl=mail-message-42"
    + "&bundleId=com.apple.mail"
  );
  assert.deepStrictEqual(payload, {
    type: "photos-import",
    paths: [resolved("/tmp/mail/photo.jpg")],
    source: "protocol",
    sourceKind: "mail",
    sourceLabel: "Mail",
    sourceDetail: "Sender: taylor@example.test | Source URL: mail-message-42 | App: Mail | Bundle: com.apple.mail",
  });
}

function testPhotosImportPreservesProviderLabelForGroupedSource() {
  const payload = parseProtocolUrl(
    "vintrace://photos-import"
    + "?file=/tmp/mail/spark.jpg"
    + "&source=mail"
    + "&appName=Spark%20Mail"
    + "&sender=casey%40example.test"
    + "&sourceUrl=spark-message-7"
  );
  assert.deepStrictEqual(payload, {
    type: "photos-import",
    paths: [resolved("/tmp/mail/spark.jpg")],
    source: "protocol",
    sourceKind: "mail",
    sourceLabel: "Spark Mail",
    sourceDetail: "Sender: casey@example.test | Source URL: spark-message-7 | App: Spark Mail",
  });
}

function testPhotosImportWithoutPathsShowsApp() {
  assert.deepStrictEqual(parseProtocolUrl("vintrace://photos-import"), { type: "show" });
}

function testWrongProtocolIgnored() {
  assert.strictEqual(parseProtocolUrl("https://photos-import?path=/tmp/a.jpg"), null);
}

testExistingProtocolRoutesRemainUnchanged();
testPhotosImportProtocolParsesRepeatedLocalPaths();
testPhotosImportRejectsUnknownSourceKindAndDedupes();
testPhotosImportBuildsSourceDetailFromAppAliases();
testPhotosImportPreservesProviderLabelForGroupedSource();
testPhotosImportWithoutPathsShowsApp();
testWrongProtocolIgnored();
console.log("external open ok");
