// Renders tizen/config.xml.tpl. Kept free of I/O so tests can cover it.

const PACKAGE_ID = /^[A-Za-z0-9]{10}$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function renderManifest(template, { packageId, version, idName = "SECRETARY_TV_PACKAGE_ID" }) {
  if (!PACKAGE_ID.test(packageId ?? "")) {
    throw new Error(
      `${idName} must be exactly 10 letters or digits; the TV rejects anything else with 'Load archive info fail [118,-4]'`,
    );
  }
  const parts = VERSION.exec(version ?? "");
  if (!parts || Number(parts[1]) > 255 || Number(parts[2]) > 255 || Number(parts[3]) > 65535) {
    throw new Error(`version "${version}" is not a Tizen version (0-255.0-255.0-65535)`);
  }
  return template.replaceAll("{{PACKAGE_ID}}", packageId).replaceAll("{{VERSION}}", version);
}

export function readApplicationId(xml) {
  const match = /<tizen:application\b[^>]*\sid="([^"]+)"/.exec(xml);
  if (!match) throw new Error("config.xml has no <tizen:application id>");
  return match[1];
}
