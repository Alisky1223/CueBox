import { parseVideoUrl } from "../player/remote-file.js";
import { closeMenus } from "./menu.js";

/**
 * "Play from a link": an inline form on the start screen and the same form in a dialog once a video is open.
 * `onSubmit` gets a validated http(s) URL. `ask` reuses the dialog to ask for another kind of link.
 */
export function initLinkForms({ button, dialog, inline, isEmpty, onSubmit }) {
  const dialogForm = dialog.querySelector("form");
  const heading = dialog.querySelector("h2");
  const action = dialogForm.querySelector("[type=submit]");
  const note = dialog.querySelector(".link-dialog-note");
  const playLink = {
    title: heading.textContent,
    action: action.textContent,
    placeholder: dialogForm.elements.url.placeholder,
    note: note.textContent,
    onSubmit,
  };
  let current = playLink;

  for (const form of [inline, dialogForm]) {
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
      (form === inline ? onSubmit : current.onSubmit)(url);
    });
  }
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  // A click on the backdrop lands on the <dialog> itself.
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

  function ask(options) {
    closeMenus();
    current = options;
    heading.textContent = options.title;
    action.textContent = options.action;
    note.textContent = options.note;
    const input = dialogForm.elements.url;
    input.placeholder = options.placeholder;
    input.setAttribute("aria-label", options.title);
    input.value = "";
    dialog.showModal();
    input.focus();
  }

  function open() {
    if (isEmpty()) return inline.elements.url.focus();
    ask(playLink);
  }

  button.onclick = open;
  return { open, ask };
}
