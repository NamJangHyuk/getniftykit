// SVG 클리너: SVG 파일 맨 앞에 붙는 XML 선언(<?xml ... ?>), DOCTYPE 선언,
// 선두 주석(<!-- ... -->)을 제거해 순수한 <svg>...</svg> 콘텐츠만 남깁니다.
// 전부 정규식/문자열 처리로 브라우저 안에서만 이뤄지고, 파일은 서버로 전송되지 않습니다.

const dropzone = document.getElementById("svgc-dropzone");
const fileInput = document.getElementById("svgc-file-input");
const chooseBtn = document.getElementById("svgc-choose-btn");
const globalError = document.getElementById("svgc-global-error");
const fileListSection = document.getElementById("svgc-file-list-section");
const fileListEl = document.getElementById("svgc-file-list");
const fileCountEl = document.getElementById("svgc-file-count");
const clearAllBtn = document.getElementById("svgc-clear-all-btn");

const STR = {
  saveBtnText: fileListSection.dataset.saveBtnText,
  removeBtnText: fileListSection.dataset.removeBtnText,
  sizeChangeTemplate: fileListSection.dataset.sizeChangeTemplate,
  unsupportedFileError: fileListSection.dataset.unsupportedFileError,
  invalidSvgError: fileListSection.dataset.invalidSvgError,
  alreadyCleanText: fileListSection.dataset.alreadyCleanText,
  removedLabel: fileListSection.dataset.removedLabel,
  removedItemText: {
    xmlDecl: fileListSection.dataset.removedXmlDecl,
    doctype: fileListSection.dataset.removedDoctype,
    comments: fileListSection.dataset.removedComments,
  },
  fileCountTemplate: fileListSection.dataset.fileCountTemplate,
  viewCodeBtnText: fileListSection.dataset.viewCodeBtnText,
  hideCodeBtnText: fileListSection.dataset.hideCodeBtnText,
  codeAreaLabel: fileListSection.dataset.codeAreaLabel,
  codeCopyBtnText: fileListSection.dataset.codeCopyBtnText,
  codeCopiedText: fileListSection.dataset.codeCopiedText,
};

let nextFileId = 1;
const entries = new Map();

// 정리 대상 문자를 실제 그림(<svg> 태그) 앞에 붙은 "머리말(prolog)" 구간에서만 찾아
// 제거합니다. <svg> 태그 이후의 실제 도형 데이터는 절대 건드리지 않습니다.
function cleanSvgText(text) {
  const svgMatch = /<svg[\s>]/i.exec(text);
  if (!svgMatch) {
    return { ok: false };
  }

  const svgIndex = svgMatch.index;
  let prolog = text.slice(0, svgIndex);
  const body = text.slice(svgIndex);
  const removed = [];

  const xmlDeclRe = /<\?xml[\s\S]*?\?>/i;
  if (xmlDeclRe.test(prolog)) {
    prolog = prolog.replace(xmlDeclRe, "");
    removed.push("xmlDecl");
  }

  // DOCTYPE의 내부 서브셋(<!DOCTYPE svg [ <!ENTITY ...> ]>)은 대괄호 안에 '>'를
  // 포함할 수 있어서, 대괄호 깊이를 세면서 깊이가 0으로 돌아온 뒤의 첫 '>'에서만
  // 선언을 종료합니다. 단순 정규식(.*?>)으로는 내부 서브셋에서 잘못 끊길 수 있습니다.
  const doctypeMatch = /<!DOCTYPE/i.exec(prolog);
  if (doctypeMatch) {
    const start = doctypeMatch.index;
    let depth = 0;
    let end = prolog.length;
    for (let i = start; i < prolog.length; i++) {
      const ch = prolog[i];
      if (ch === "[") depth++;
      else if (ch === "]") depth = Math.max(0, depth - 1);
      else if (ch === ">" && depth === 0) {
        end = i + 1;
        break;
      }
    }
    prolog = prolog.slice(0, start) + prolog.slice(end);
    removed.push("doctype");
  }

  const commentRe = /<!--[\s\S]*?-->/g;
  if (commentRe.test(prolog)) {
    prolog = prolog.replace(commentRe, "");
    removed.push("comments");
  }

  const remainingProlog = prolog.trim();
  const cleanedText = remainingProlog ? `${remainingProlog}\n${body}` : body;

  return { ok: true, text: cleanedText, removed };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function removedSummaryText(removed) {
  if (removed.length === 0) return STR.alreadyCleanText;
  const items = removed.map((key) => STR.removedItemText[key]).join(", ");
  return `${STR.removedLabel} ${items}`;
}

function updateFileCount() {
  fileCountEl.textContent = STR.fileCountTemplate.replace("{count}", entries.size);
  fileListSection.hidden = entries.size === 0;
}

function showGlobalError(message) {
  globalError.textContent = message;
  globalError.hidden = false;
}

function clearGlobalError() {
  globalError.hidden = true;
}

function isSvgFile(file) {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

async function addFiles(fileList) {
  const files = Array.from(fileList);
  let hadUnsupported = false;

  for (const file of files) {
    if (!isSvgFile(file)) {
      hadUnsupported = true;
      continue;
    }
    clearGlobalError();
    const id = String(nextFileId++);
    const entry = { id, file, resultUrl: null };
    entries.set(id, entry);
    const card = renderFileCard(entry);
    fileListEl.appendChild(card);
    processFile(entry, card);
  }

  if (hadUnsupported) {
    showGlobalError(STR.unsupportedFileError);
  }

  updateFileCount();
}

function renderFileCard(entry) {
  const card = document.createElement("div");
  card.className = "svgc-file-card";
  card.dataset.fileId = entry.id;

  const info = document.createElement("div");
  info.className = "svgc-file-info";

  const nameEl = document.createElement("span");
  nameEl.className = "svgc-file-name";
  nameEl.textContent = entry.file.name;

  const metaEl = document.createElement("span");
  metaEl.className = "svgc-file-meta";
  metaEl.textContent = formatBytes(entry.file.size);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "svgc-remove-btn";
  removeBtn.setAttribute("aria-label", STR.removeBtnText);
  removeBtn.textContent = "×";

  info.appendChild(nameEl);
  info.appendChild(metaEl);
  info.appendChild(removeBtn);

  const status = document.createElement("div");
  status.className = "svgc-file-status";

  const statusText = document.createElement("span");
  statusText.className = "svgc-file-status-text";
  status.appendChild(statusText);

  const codeBlock = document.createElement("div");
  codeBlock.className = "svgc-code-block";
  codeBlock.hidden = true;

  const codeHeader = document.createElement("div");
  codeHeader.className = "svgc-code-block-header";

  const codeLabel = document.createElement("span");
  codeLabel.className = "svgc-code-block-label";
  codeLabel.textContent = STR.codeAreaLabel;

  const codeCopyBtn = document.createElement("button");
  codeCopyBtn.type = "button";
  codeCopyBtn.className = "svgc-code-copy-btn";
  codeCopyBtn.textContent = STR.codeCopyBtnText;

  codeHeader.appendChild(codeLabel);
  codeHeader.appendChild(codeCopyBtn);

  const codeTextarea = document.createElement("textarea");
  codeTextarea.className = "svgc-code-textarea";
  codeTextarea.readOnly = true;
  codeTextarea.rows = 6;
  codeTextarea.spellcheck = false;
  codeTextarea.setAttribute("aria-label", STR.codeAreaLabel);

  codeBlock.appendChild(codeHeader);
  codeBlock.appendChild(codeTextarea);

  card.appendChild(info);
  card.appendChild(status);
  card.appendChild(codeBlock);
  return card;
}

function setStatusDone(card, entry, result) {
  const status = card.querySelector(".svgc-file-status");
  status.classList.remove("svgc-status-error");
  status.innerHTML = "";

  const text = document.createElement("span");
  text.className = "svgc-file-status-text";
  if (result.removed.length === 0) {
    text.textContent = STR.alreadyCleanText;
  } else {
    const sizeText = STR.sizeChangeTemplate
      .replace("{fromSize}", formatBytes(entry.file.size))
      .replace("{toSize}", formatBytes(result.blob.size));
    text.textContent = `${removedSummaryText(result.removed)} · ${sizeText}`;
  }
  status.appendChild(text);

  const viewCodeBtn = document.createElement("button");
  viewCodeBtn.type = "button";
  viewCodeBtn.className = "svgc-view-code-btn";
  viewCodeBtn.textContent = STR.viewCodeBtnText;
  status.appendChild(viewCodeBtn);

  const saveBtn = document.createElement("a");
  saveBtn.className = "svgc-save-btn";
  saveBtn.textContent = STR.saveBtnText;
  saveBtn.href = entry.resultUrl;
  saveBtn.download = entry.file.name;
  status.appendChild(saveBtn);

  const codeTextarea = card.querySelector(".svgc-code-textarea");
  codeTextarea.value = entry.cleanedText;
}

function setStatusError(card) {
  const status = card.querySelector(".svgc-file-status");
  status.classList.add("svgc-status-error");
  status.innerHTML = "";
  const text = document.createElement("span");
  text.className = "svgc-file-status-text";
  text.textContent = STR.invalidSvgError;
  status.appendChild(text);
}

async function processFile(entry, card) {
  try {
    const text = await entry.file.text();
    const result = cleanSvgText(text);
    if (!result.ok) {
      setStatusError(card);
      return;
    }
    const blob = new Blob([result.text], { type: "image/svg+xml" });
    entry.resultUrl = URL.createObjectURL(blob);
    entry.cleanedText = result.text;
    setStatusDone(card, entry, { removed: result.removed, blob });
  } catch (err) {
    setStatusError(card);
  }
}

function removeEntry(id) {
  const entry = entries.get(id);
  if (!entry) return;
  if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
  entries.delete(id);
  const card = fileListEl.querySelector(`[data-file-id="${id}"]`);
  if (card) card.remove();
  updateFileCount();
}

function clearAll() {
  for (const id of Array.from(entries.keys())) {
    removeEntry(id);
  }
}

fileListEl.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".svgc-remove-btn");
  if (removeBtn) {
    const card = removeBtn.closest(".svgc-file-card");
    removeEntry(card.dataset.fileId);
    return;
  }

  const viewCodeBtn = e.target.closest(".svgc-view-code-btn");
  if (viewCodeBtn) {
    const card = viewCodeBtn.closest(".svgc-file-card");
    const codeBlock = card.querySelector(".svgc-code-block");
    codeBlock.hidden = !codeBlock.hidden;
    viewCodeBtn.textContent = codeBlock.hidden ? STR.viewCodeBtnText : STR.hideCodeBtnText;
    return;
  }

  const codeCopyBtn = e.target.closest(".svgc-code-copy-btn");
  if (codeCopyBtn) {
    const codeTextarea = codeCopyBtn.closest(".svgc-code-block").querySelector(".svgc-code-textarea");
    copyToClipboard(codeTextarea, codeCopyBtn, STR.codeCopyBtnText, STR.codeCopiedText);
  }
});

async function copyToClipboard(textarea, btn, defaultText, copiedText) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    btn.textContent = copiedText;
    setTimeout(() => {
      btn.textContent = defaultText;
    }, 1500);
  } catch (err) {
    textarea.select();
  }
}

clearAllBtn.addEventListener("click", clearAll);

chooseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) addFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("svgc-dropzone-active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("svgc-dropzone-active");
  });
});

dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) {
    addFiles(e.dataTransfer.files);
  }
});

updateFileCount();

// --- 코드 직접 붙여넣기 ---

const pasteInput = document.getElementById("svgc-paste-input");
const pasteCleanBtn = document.getElementById("svgc-paste-clean-btn");
const pasteError = document.getElementById("svgc-paste-error");
const pasteResult = document.getElementById("svgc-paste-result");
const pasteResultSummary = document.getElementById("svgc-paste-result-summary");
const pasteOutput = document.getElementById("svgc-paste-output");
const pasteCopyBtn = document.getElementById("svgc-paste-copy-btn");

const pasteStr = {
  emptyError: pasteInput.closest(".svgc-paste-body").dataset.emptyError,
  invalidError: pasteInput.closest(".svgc-paste-body").dataset.invalidError,
  copiedText: pasteCopyBtn.dataset.copiedText,
  copyBtnText: pasteCopyBtn.textContent,
};

pasteCleanBtn.addEventListener("click", () => {
  const raw = pasteInput.value;
  pasteError.hidden = true;
  pasteResult.hidden = true;

  if (!raw.trim()) {
    pasteError.textContent = pasteStr.emptyError;
    pasteError.hidden = false;
    return;
  }

  const result = cleanSvgText(raw);
  if (!result.ok) {
    pasteError.textContent = pasteStr.invalidError;
    pasteError.hidden = false;
    return;
  }

  pasteResultSummary.textContent = removedSummaryText(result.removed);
  pasteOutput.value = result.text;
  pasteResult.hidden = false;
});

pasteCopyBtn.addEventListener("click", () => {
  copyToClipboard(pasteOutput, pasteCopyBtn, pasteStr.copyBtnText, pasteStr.copiedText);
});
