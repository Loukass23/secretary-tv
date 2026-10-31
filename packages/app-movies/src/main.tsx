import { installBackAdapter, registerMediaKeys, runBootAnimation } from "@secretary/tv-kit";
import { CatalogApp } from "@secretary/catalog-kit";
import { render } from "preact";

try {
  installBackAdapter(window);
  registerMediaKeys();
} catch (err) {
  console.warn("[boot] platform install failed", err);
}

render(
  <CatalogApp type="movie" heading="Secretary Cinema" serverUrl={__SERVER_URL__} returnTo={__RETURN_TO__} />,
  document.getElementById("root")!,
);

runBootAnimation();
