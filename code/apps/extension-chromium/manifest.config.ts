const manifest = {
  manifest_version: 3,
  name: "Optimando Helper (Chromium)",
  version: "0.0.1",
  action: { default_popup: "popup.html" },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["storage","tabs"],
  host_permissions: ["http://127.0.0.1/*","http://localhost/*"]
}
export default manifest
