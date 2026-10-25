// Footer section: shows when the server status was last refreshed.
// The topbar section sends the text through the shared "status" event.
import { $ } from "../../shared/dom.js";
import { on } from "../../shared/store.js";

export function initFooter() {
  on("status", (text) => {
    $("lastUpdated").textContent = text;
  });
}
