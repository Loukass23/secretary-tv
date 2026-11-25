import { test } from "node:test";
import assert from "node:assert/strict";
import { appIcon, isPlaceholderIcon } from "../src/app-icons.ts";
import { YOUTUBE_APP_ID } from "../src/config.ts";

test("YouTube and Workspace get their own icon, whatever the TV reports", () => {
  const yt = appIcon({ id: YOUTUBE_APP_ID, name: "YouTube", iconPath: "/usr/share/icons/default/small/app.png" });
  assert.match(yt ?? "", /^data:image\/svg\+xml,/);
  assert.match(appIcon({ id: "AbCdEf1234.Workspace", name: "Workspace", iconPath: "/opt/share/icons/default.png" }) ?? "", /^data:image\/svg\+xml,/);
  assert.match(appIcon({ id: "AbCdEf1234.Workspace", name: "Samsung Workspace" }) ?? "", /^data:image\/svg\+xml,/);
  assert.notEqual(appIcon({ id: "x", name: "YouTube" }), appIcon({ id: "y", name: "Workspace" }));
});

test("another app keeps its own icon, and a placeholder gives way to its initial", () => {
  assert.equal(appIcon({ id: "AbCdEf1234.Music", name: "Music", iconPath: "/opt/usr/apps/music/shared/res/music.png" }), "/opt/usr/apps/music/shared/res/music.png");
  assert.equal(appIcon({ id: "AbCdEf1234.Guide", name: "User Guide", iconPath: "/usr/share/icons/default/small/apps_img_default.png" }), undefined);
  assert.equal(appIcon({ id: "AbCdEf1234.Guide", name: "User Guide" }), undefined);
});

test("placeholder icons are told from real ones", () => {
  assert.equal(isPlaceholderIcon(undefined), true);
  assert.equal(isPlaceholderIcon(""), true);
  assert.equal(isPlaceholderIcon("/usr/share/icons/default.png"), true);
  assert.equal(isPlaceholderIcon("/usr/share/icons/tizen_logo.png"), true);
  assert.equal(isPlaceholderIcon("/opt/usr/apps/defaultsoft/shared/res/icon.png"), false, "a word that only starts with default is not one");
  assert.equal(isPlaceholderIcon("/opt/usr/apps/AbCdEf1234/shared/res/icon.png"), false);
});
