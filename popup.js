const STORAGE_KEY = "savedPrompts";
const MAX_PROMPT_LENGTH = 4000;

const dom = {
  tabCreate: document.getElementById("tab-create"),
  tabList: document.getElementById("tab-list"),
  createPanel: document.getElementById("create-panel"),
  listPanel: document.getElementById("list-panel"),
  promptInput: document.getElementById("prompt-input"),
  charCounter: document.getElementById("char-counter"),
  saveButton: document.getElementById("save-btn"),
  searchInput: document.getElementById("search-input"),
  createStatus: document.getElementById("create-status"),
  listStatus: document.getElementById("list-status"),
  libraryRoot: document.getElementById("library-root"),
  promptCount: document.getElementById("prompt-count"),
  libraryMeta: document.getElementById("library-meta"),
  promptList: document.getElementById("prompt-list"),
  promptItemTemplate: document.getElementById("prompt-item-template")
};

const state = {
  prompts: [],
  searchQuery: "",
  activeTab: "create"
};

const extensionApi = (() => {
  const hasFirefoxApi = typeof browser !== "undefined" && browser?.storage?.local;
  const hasChromeApi = typeof chrome !== "undefined" && chrome?.storage?.local;

  return {
    browserApi: hasFirefoxApi ? browser : null,
    chromeApi: hasChromeApi ? chrome : null
  };
})();

function getStorageLocal() {
  if (extensionApi.browserApi?.storage?.local) {
    return extensionApi.browserApi.storage.local;
  }

  if (extensionApi.chromeApi?.storage?.local) {
    return extensionApi.chromeApi.storage.local;
  }

  throw new Error("No supported storage API found.");
}

function storageGet(key) {
  if (extensionApi.browserApi?.storage?.local) {
    return extensionApi.browserApi.storage.local.get(key);
  }

  return new Promise((resolve, reject) => {
    const storageLocal = getStorageLocal();
    storageLocal.get(key, (result) => {
      const runtimeError = extensionApi.chromeApi?.runtime?.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(result ?? {});
    });
  });
}

function storageSet(payload) {
  if (extensionApi.browserApi?.storage?.local) {
    return extensionApi.browserApi.storage.local.set(payload);
  }

  return new Promise((resolve, reject) => {
    const storageLocal = getStorageLocal();
    storageLocal.set(payload, () => {
      const runtimeError = extensionApi.chromeApi?.runtime?.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve();
    });
  });
}

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(timestamp) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  } catch (_) {
    return "Unknown date";
  }
}

function normalizePrompt(text) {
  return text.replace(/\s+/g, " ").trim();
}

function sanitizePrompt(text) {
  return text.trim().slice(0, MAX_PROMPT_LENGTH);
}

function setStatus(message, isError = false) {
  [dom.createStatus, dom.listStatus].forEach((statusElement) => {
    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
  });
}

function updateCharacterCounter() {
  const length = dom.promptInput.value.length;
  dom.charCounter.textContent = `${length} / ${MAX_PROMPT_LENGTH}`;
}

function getPromptCountLabel(count) {
  return `${count} prompt${count === 1 ? "" : "s"}`;
}

function updateLibraryMeta(totalCount, filteredCount) {
  const hasSearch = state.searchQuery.length > 0;
  const stateName = filteredCount === 0 ? "empty" : filteredCount === 1 ? "single" : "many";

  dom.promptList.dataset.state = stateName;
  if (dom.libraryRoot) {
    dom.libraryRoot.dataset.state = stateName;
  }

  if (dom.promptCount) {
    dom.promptCount.textContent = hasSearch
      ? `${filteredCount} of ${totalCount}`
      : getPromptCountLabel(totalCount);
  }

  if (!dom.libraryMeta) {
    return;
  }

  if (totalCount === 0) {
    dom.libraryMeta.textContent = "No prompts yet. Save your first one in Create.";
    return;
  }

  if (hasSearch && filteredCount === 0) {
    const clippedQuery =
      state.searchQuery.length > 28
        ? `${state.searchQuery.slice(0, 28).trimEnd()}...`
        : state.searchQuery;
    dom.libraryMeta.textContent = `No matches for "${clippedQuery}".`;
    return;
  }

  if (hasSearch) {
    dom.libraryMeta.textContent = `${filteredCount} match${filteredCount === 1 ? "" : "es"} found.`;
    return;
  }

  if (totalCount === 1) {
    dom.libraryMeta.textContent = "One saved prompt, ready to reuse.";
    return;
  }

  dom.libraryMeta.textContent = `${getPromptCountLabel(totalCount)} ready to copy.`;
}

async function readPromptsFromStorage() {
  try {
    const result = await storageGet(STORAGE_KEY);
    const rawPrompts = result?.[STORAGE_KEY];

    if (!Array.isArray(rawPrompts)) {
      return [];
    }

    return rawPrompts.filter((prompt) => {
      return (
        prompt &&
        typeof prompt.id === "string" &&
        typeof prompt.text === "string" &&
        typeof prompt.createdAt === "number"
      );
    });
  } catch (error) {
    console.error("Failed to load prompts:", error);
    setStatus("Could not load prompts from local storage.", true);
    return [];
  }
}

async function writePromptsToStorage(prompts) {
  try {
    await storageSet({ [STORAGE_KEY]: prompts });
    return true;
  } catch (error) {
    console.error("Failed to save prompts:", error);
    setStatus("Could not save prompts. Please try again.", true);
    return false;
  }
}

function getFilteredPrompts() {
  if (!state.searchQuery) {
    return state.prompts;
  }

  const query = state.searchQuery.toLowerCase();
  return state.prompts.filter((prompt) => prompt.text.toLowerCase().includes(query));
}

function createPromptListItem(prompt) {
  const fragment = dom.promptItemTemplate.content.cloneNode(true);
  const item = fragment.querySelector(".prompt-item");
  const textNode = fragment.querySelector(".prompt-text");
  const timeNode = fragment.querySelector(".prompt-time");
  const copyBtn = fragment.querySelector(".btn-copy");
  const deleteBtn = fragment.querySelector(".btn-danger");

  item.dataset.promptId = prompt.id;
  textNode.textContent = prompt.text;
  timeNode.textContent = `Saved ${formatDate(prompt.createdAt)}`;
  timeNode.dateTime = new Date(prompt.createdAt).toISOString();

  copyBtn.addEventListener("click", async () => {
    await copyPromptToClipboard(prompt.text, copyBtn);
  });

  deleteBtn.addEventListener("click", async () => {
    await deletePrompt(prompt.id);
  });

  return fragment;
}

function renderPromptList() {
  const prompts = getFilteredPrompts();
  const totalCount = state.prompts.length;
  const filteredCount = prompts.length;

  updateLibraryMeta(totalCount, filteredCount);
  dom.promptList.innerHTML = "";

  if (prompts.length === 0) {
    const message = state.searchQuery
      ? "No prompts match your search."
      : "No saved prompts yet. Add your first one in Create.";
    const emptyState = document.createElement("li");
    emptyState.className = "empty-state";
    emptyState.textContent = message;
    dom.promptList.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  prompts.forEach((prompt) => fragment.appendChild(createPromptListItem(prompt)));
  dom.promptList.appendChild(fragment);
}

async function savePrompt() {
  const rawInput = dom.promptInput.value;
  const sanitized = sanitizePrompt(rawInput);

  if (!sanitized) {
    setStatus("Prompt is empty. Enter text before saving.", true);
    dom.promptInput.focus();
    return;
  }

  const normalizedInput = normalizePrompt(sanitized);
  const duplicateExists = state.prompts.some(
    (prompt) => normalizePrompt(prompt.text) === normalizedInput
  );

  if (duplicateExists) {
    setStatus("This prompt already exists in your library.");
    return;
  }

  const newPrompt = {
    id: generateId(),
    text: sanitized,
    createdAt: Date.now()
  };

  const updatedPrompts = [newPrompt, ...state.prompts];
  const didPersist = await writePromptsToStorage(updatedPrompts);

  if (!didPersist) {
    return;
  }

  state.prompts = updatedPrompts;
  dom.promptInput.value = "";
  updateCharacterCounter();
  renderPromptList();
  setStatus("Prompt saved.");
}

async function deletePrompt(promptId) {
  const updatedPrompts = state.prompts.filter((prompt) => prompt.id !== promptId);

  if (updatedPrompts.length === state.prompts.length) {
    return;
  }

  const didPersist = await writePromptsToStorage(updatedPrompts);

  if (!didPersist) {
    return;
  }

  state.prompts = updatedPrompts;
  renderPromptList();
  setStatus("Prompt deleted.");
}

async function copyPromptToClipboard(text, buttonElement) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      legacyCopyToClipboard(text);
    }

    const previousLabel = buttonElement.textContent;
    buttonElement.textContent = "Copied!";
    buttonElement.classList.add("is-copied");

    window.setTimeout(() => {
      buttonElement.textContent = previousLabel;
      buttonElement.classList.remove("is-copied");
    }, 1100);

    setStatus("Copied prompt to clipboard.");
  } catch (error) {
    console.error("Clipboard write failed:", error);
    setStatus("Clipboard access failed. Check browser permissions.", true);
  }
}

function legacyCopyToClipboard(text) {
  const tempTextarea = document.createElement("textarea");
  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  tempTextarea.value = text;
  tempTextarea.setAttribute("readonly", "");
  tempTextarea.style.position = "fixed";
  tempTextarea.style.top = "-9999px";
  tempTextarea.style.left = "-9999px";
  document.body.appendChild(tempTextarea);
  tempTextarea.select();

  const didCopy = document.execCommand("copy");
  document.body.removeChild(tempTextarea);

  if (selection && previousRange) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }

  if (!didCopy) {
    throw new Error("Fallback clipboard copy failed.");
  }
}

function handleSearchInput(event) {
  state.searchQuery = event.target.value.trim();
  renderPromptList();
}

function setActiveTab(tabName) {
  const showCreate = tabName === "create";
  state.activeTab = showCreate ? "create" : "list";

  dom.tabCreate.classList.toggle("is-active", showCreate);
  dom.tabCreate.setAttribute("aria-selected", String(showCreate));
  dom.tabCreate.tabIndex = showCreate ? 0 : -1;

  dom.tabList.classList.toggle("is-active", !showCreate);
  dom.tabList.setAttribute("aria-selected", String(!showCreate));
  dom.tabList.tabIndex = showCreate ? -1 : 0;

  dom.createPanel.hidden = !showCreate;
  dom.createPanel.classList.toggle("is-active", showCreate);

  dom.listPanel.hidden = showCreate;
  dom.listPanel.classList.toggle("is-active", !showCreate);
}

async function initializeApp() {
  updateCharacterCounter();
  setActiveTab("create");

  state.prompts = await readPromptsFromStorage();
  state.prompts.sort((a, b) => b.createdAt - a.createdAt);
  renderPromptList();

  dom.tabCreate.addEventListener("click", () => setActiveTab("create"));
  dom.tabList.addEventListener("click", () => setActiveTab("list"));

  dom.promptInput.addEventListener("input", updateCharacterCounter);
  dom.saveButton.addEventListener("click", savePrompt);
  dom.searchInput.addEventListener("input", handleSearchInput);

  dom.promptInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void savePrompt();
    }
  });
}
function boot() {
  initializeApp().catch((error) => {
    console.error("Initialization error:", error);
    setStatus("Something went wrong while starting the extension.", true);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
