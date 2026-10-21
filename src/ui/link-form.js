import { parseVideoUrl } from "../player/remote-file.js";
import { closeMenus } from "./menu.js";

/**
 * "Play from a link": an inline form on the start screen and the same form in a dialog once a video is open.
 * `onSubmit` gets a validated http(s) URL.
 */
export function initLinkForms({ button, dialog, inline, isEmpty, onSubmit }) {
  for (const form of [inline, dialog.querySelector("form")]) {
    const input = form.elements.url;
    input.addEventListener("input", () => input.setCustomValidity(""));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const url = parseVideoUrl(input.value);
      if (!url) {
        input.setCustomValidity("Enter a link that starts with http:// or https://");
        return input.reportValidity();
      }
      dialog.close();
      input.blur();
      onSubmit(url);
    });
  }
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  // A click on the backdrop lands on the <dialog> itself.
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

  function open() {
    if (isEmpty()) return inline.elements.url.focus();
    closeMenus();
    const input = dialog.querySelector("form").elements.url;
    input.value = "";
    dialog.showModal();
    input.focus();
  }

  button.onclick = open;
  return { open };
}
