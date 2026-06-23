import {
  App,
  Editor,
  EditorPosition,
  EventRef,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
  TFile
} from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate
} from "@codemirror/view";

type CommentDisplayMode = "bottom-sheet" | "inline-popover";
type UnderlineStyle = "solid" | "dotted" | "dashed" | "wavy";

interface HighlightStyle {
  id: string;
  name: string;
  backgroundColor: string;
  textColor: string;
  underlineColor: string;
  underlineStyle: UnderlineStyle;
}

interface CommentRecord {
  id: string;
  filePath: string;
  quote: string;
  comment: string;
  styleId: string;
  createdAt: number;
  updatedAt: number;
}

interface NotesCommentsSettings {
  displayMode: CommentDisplayMode;
  defaultStyleId: string;
  styles: HighlightStyle[];
  comments: CommentRecord[];
}

interface CommentSpanMatch {
  id: string;
  styleId: string | null;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

interface CreateCommentDraft {
  editor: Editor;
  filePath: string;
  selectedText: string;
  from: EditorPosition;
  to: EditorPosition;
}

interface StylePickerControl {
  getValue: () => string;
  close: () => void;
}

type RegisterEditorMenuEvent = (
  name: "editor-menu",
  callback: (menu: Menu, editor: Editor, view: MarkdownView) => void
) => EventRef;

const DEFAULT_STYLE_ID = "yellow-marker";

const DEFAULT_STYLES: HighlightStyle[] = [
  {
    id: DEFAULT_STYLE_ID,
    name: "黄色荧光",
    backgroundColor: "#fff3a3",
    textColor: "#1f2937",
    underlineColor: "#f59e0b",
    underlineStyle: "solid"
  },
  {
    id: "blue-note",
    name: "蓝色批注",
    backgroundColor: "#dbeafe",
    textColor: "#172554",
    underlineColor: "#2563eb",
    underlineStyle: "solid"
  },
  {
    id: "green-dotted",
    name: "绿色虚线",
    backgroundColor: "#dcfce7",
    textColor: "#052e16",
    underlineColor: "#16a34a",
    underlineStyle: "dotted"
  },
  {
    id: "rose-wavy",
    name: "玫瑰波浪",
    backgroundColor: "#ffe4e6",
    textColor: "#4a044e",
    underlineColor: "#db2777",
    underlineStyle: "wavy"
  }
];

const DEFAULT_SETTINGS: NotesCommentsSettings = {
  displayMode: "bottom-sheet",
  defaultStyleId: DEFAULT_STYLE_ID,
  styles: cloneStyles(DEFAULT_STYLES),
  comments: []
};

export default class NotesCommentsPlugin extends Plugin {
  settings: NotesCommentsSettings = DEFAULT_SETTINGS;
  private bottomSheetEl: HTMLElement | null = null;
  private inlinePopoverEl: HTMLElement | null = null;
  private editPopoverEl: HTMLElement | null = null;
  private dynamicStyleEl: HTMLStyleElement | null = null;
  private inlineAnchorEl: HTMLElement | null = null;
  private editAnchorEl: HTMLElement | null = null;
  private createAnchorRange: Range | null = null;
  private activeEditCommentId: string | null = null;
  private hideTimer: number | null = null;
  private editSaveTimer: number | null = null;
  private repositionFrame: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.createHoverSurfaces();
    this.refreshDynamicStyles();
    this.registerMarkdownPostProcessor((el: HTMLElement) => {
      this.prepareRenderedMarks(el);
    });
    this.registerEditorExtension(createCommentHighlightExtension(this));
    this.registerEditorContextMenu();

    this.addCommand({
      id: "add-highlight-comment",
      name: "添加标记留言",
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        this.openCreateCommentPopover(editor, ctx);
      }
    });

    this.addCommand({
      id: "edit-highlight-comment-at-cursor",
      name: "编辑光标处的标记留言",
      editorCallback: (editor: Editor) => {
        this.openEditCommentAtCursor(editor);
      }
    });

    this.addCommand({
      id: "remove-highlight-comment-at-cursor",
      name: "删除光标处的标记留言",
      editorCallback: (editor: Editor) => {
        void this.removeCommentAtCursor(editor);
      }
    });

    this.addSettingTab(new NotesCommentsSettingTab(this.app, this));
  }

  private registerEditorContextMenu(): void {
    const onEditorMenu = this.app.workspace.on.bind(this.app.workspace) as unknown as RegisterEditorMenuEvent;

    this.registerEvent(
      onEditorMenu("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
        if (editor.getSelection().trim()) {
          menu.addItem((item) => {
            item
              .setTitle("添加标记留言")
              .setIcon("message-square-plus")
              .onClick(() => {
                this.openCreateCommentPopover(editor, view);
              });
          });
        }

        const span = findCommentSpanAtOffset(editor.getValue(), editor.posToOffset(editor.getCursor()));
        if (!span) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle("编辑标记留言")
            .setIcon("pencil")
            .onClick(() => {
              this.openEditCommentPopover(span.id);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("删除标记留言")
            .setIcon("trash-2")
            .onClick(() => {
              void this.removeCommentAtCursor(editor);
            });
        });
      })
    );
  }

  onunload(): void {
    this.clearHideTimer();
    this.clearRepositionFrame();
    this.flushEditSave();
    this.hideHoverSurfaces();
    this.closeEditPopover();
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<NotesCommentsSettings> | null;

    const styles = normalizeStyles(loaded?.styles);
    const loadedDefaultStyleId = typeof loaded?.defaultStyleId === "string" ? loaded.defaultStyleId : undefined;
    const fallbackStyleId = styles[0]?.id ?? DEFAULT_STYLE_ID;
    const defaultStyleId: string =
      loadedDefaultStyleId && styles.some((style) => style.id === loadedDefaultStyleId)
        ? loadedDefaultStyleId
        : fallbackStyleId;

    this.settings = {
      displayMode: loaded?.displayMode === "inline-popover" ? "inline-popover" : "bottom-sheet",
      defaultStyleId,
      styles,
      comments: normalizeComments(loaded?.comments, defaultStyleId)
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshDynamicStyles();
  }

  getComment(id: string): CommentRecord | null {
    return this.settings.comments.find((comment) => comment.id === id) ?? null;
  }

  getStyle(styleId: string | null | undefined): HighlightStyle {
    return (
      this.settings.styles.find((style) => style.id === styleId) ??
      this.settings.styles.find((style) => style.id === this.settings.defaultStyleId) ??
      this.settings.styles[0] ??
      DEFAULT_STYLES[0]
    );
  }

  async addCustomStyle(): Promise<void> {
    const id = `custom-${Date.now().toString(36)}`;
    this.settings.styles.push({
      id,
      name: "自定义样式",
      backgroundColor: "#fef9c3",
      textColor: "#1f2937",
      underlineColor: "#a16207",
      underlineStyle: "solid"
    });
    this.settings.defaultStyleId = id;
    await this.saveSettings();
  }

  async removeStyle(styleId: string): Promise<void> {
    if (this.settings.styles.length <= 1) {
      new Notice("至少需要保留一个标记样式。");
      return;
    }

    const fallbackStyle = this.settings.styles.find((style) => style.id !== styleId);
    if (!fallbackStyle) {
      return;
    }

    this.settings.styles = this.settings.styles.filter((style) => style.id !== styleId);
    if (this.settings.defaultStyleId === styleId) {
      this.settings.defaultStyleId = fallbackStyle.id;
    }
    for (const comment of this.settings.comments) {
      if (comment.styleId === styleId) {
        comment.styleId = fallbackStyle.id;
        comment.updatedAt = Date.now();
      }
    }

    await this.saveSettings();
  }

  async resetStyles(): Promise<void> {
    this.settings.styles = cloneStyles(DEFAULT_STYLES);
    if (!this.settings.styles.some((style) => style.id === this.settings.defaultStyleId)) {
      this.settings.defaultStyleId = DEFAULT_STYLE_ID;
    }
    for (const comment of this.settings.comments) {
      if (!this.settings.styles.some((style) => style.id === comment.styleId)) {
        comment.styleId = this.settings.defaultStyleId;
        comment.updatedAt = Date.now();
      }
    }
    await this.saveSettings();
  }

  openCreateCommentPopover(editor: Editor, view: MarkdownView | MarkdownFileInfo): void {
    const selectedText = editor.getSelection();
    if (!selectedText.trim()) {
      new Notice("请先选中需要标记的文字。");
      return;
    }

    if (selectedText.includes("</span>")) {
      new Notice("选区包含 </span>，暂时无法安全添加标记。");
      return;
    }

    const filePath = view.file?.path;
    if (!filePath) {
      new Notice("当前没有可写入的 Markdown 文件。");
      return;
    }

    const draft: CreateCommentDraft = {
      editor,
      filePath,
      selectedText,
      from: editor.getCursor("from"),
      to: editor.getCursor("to")
    };
    const selectionRange = this.getSelectionRange();
    const selectionRect = selectionRange ? getVisibleRangeRect(selectionRange) : null;

    if (!this.editPopoverEl) {
      return;
    }

    this.activeEditCommentId = null;
    this.editAnchorEl = null;
    this.closeEditPopover();
    this.createAnchorRange = selectionRange;
    this.hideHoverSurfaces();
    this.renderCreatePopover(draft);
    this.editPopoverEl.addClass("onc-visible");

    if (selectionRect) {
      this.positionFloatingElementAtRect(this.editPopoverEl, selectionRect, 10);
    } else {
      this.positionEditPopoverAtCenter();
    }

    const textarea = this.editPopoverEl.querySelector<HTMLTextAreaElement>(".onc-edit-textarea");
    window.setTimeout(() => {
      if (!textarea) {
        return;
      }
      this.autoResizeTextarea(textarea);
      textarea.focus();
    }, 0);
  }

  openEditCommentAtCursor(editor: Editor): void {
    const span = findCommentSpanAtOffset(editor.getValue(), editor.posToOffset(editor.getCursor()));
    if (!span) {
      new Notice("光标不在标记留言中。");
      return;
    }

    this.openEditCommentPopover(span.id);
  }

  async removeCommentAtCursor(editor: Editor): Promise<void> {
    const span = findCommentSpanAtOffset(editor.getValue(), editor.posToOffset(editor.getCursor()));
    if (!span) {
      new Notice("光标不在标记留言中。");
      return;
    }

    if (!window.confirm("确定删除这个标记和留言吗？")) {
      return;
    }

    await this.deleteComment(span.id, true);
  }

  openEditCommentPopover(id: string, sourceEl?: HTMLElement | null): void {
    const comment = this.getComment(id);
    if (!comment) {
      new Notice("未找到这条留言的数据。");
      return;
    }

    const anchorEl = sourceEl ?? this.findVisibleMarkElement(id);
    if (!this.editPopoverEl) {
      return;
    }

    this.hideHoverSurfaces();
    this.renderEditPopover(comment);
    this.editPopoverEl.addClass("onc-visible");
    this.activeEditCommentId = id;
    this.editAnchorEl = anchorEl ?? null;
    this.createAnchorRange = null;

    if (anchorEl) {
      this.positionFloatingElement(this.editPopoverEl, anchorEl, 10);
    } else {
      this.positionEditPopoverAtCenter();
    }

    const textarea = this.editPopoverEl.querySelector<HTMLTextAreaElement>(".onc-edit-textarea");
    window.setTimeout(() => {
      if (!textarea) {
        return;
      }
      this.autoResizeTextarea(textarea);
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);
  }

  async deleteComment(id: string, unwrapMarkup: boolean): Promise<void> {
    const comment = this.getComment(id);
    const filePath = comment?.filePath;
    let markupChanged = false;

    if (unwrapMarkup) {
      markupChanged = await this.rewriteCommentMarkup((markdown) => unwrapCommentMarkup(markdown, id), filePath);
    }

    this.settings.comments = this.settings.comments.filter((record) => record.id !== id);
    await this.saveSettings();
    this.hideHoverSurfaces();
    new Notice(unwrapMarkup && !markupChanged ? "已删除留言数据，但没有找到正文标记。" : "已删除标记留言。");
  }

  private createHoverSurfaces(): void {
    const bottomSheetEl = document.createElement("div");
    bottomSheetEl.className = "onc-bottom-sheet";
    document.body.appendChild(bottomSheetEl);
    this.bottomSheetEl = bottomSheetEl;

    const inlinePopoverEl = document.createElement("div");
    inlinePopoverEl.className = "onc-inline-popover";
    document.body.appendChild(inlinePopoverEl);
    this.inlinePopoverEl = inlinePopoverEl;

    const editPopoverEl = document.createElement("div");
    editPopoverEl.className = "onc-edit-popover";
    document.body.appendChild(editPopoverEl);
    this.editPopoverEl = editPopoverEl;

    this.register(() => {
      this.bottomSheetEl?.remove();
      this.inlinePopoverEl?.remove();
      this.editPopoverEl?.remove();
      this.dynamicStyleEl?.remove();
    });

    this.registerDomEvent(document, "pointerover", (event: PointerEvent) => {
      const mark = findClosestCommentMark(event.target);
      if (!mark) {
        return;
      }
      this.clearHideTimer();
      this.showCommentForElement(mark);
    });

    this.registerDomEvent(document, "pointerout", (event: PointerEvent) => {
      const mark = findClosestCommentMark(event.target);
      if (!mark) {
        return;
      }

      const related = event.relatedTarget;
      if (related instanceof Node && (mark.contains(related) || this.isInsideHoverSurface(related))) {
        return;
      }
      this.scheduleHideHoverSurfaces();
    });

    this.registerDomEvent(document, "focusin", (event: FocusEvent) => {
      const mark = findClosestCommentMark(event.target);
      if (!mark) {
        return;
      }
      this.clearHideTimer();
      this.showCommentForElement(mark);
    });

    this.registerDomEvent(document, "focusout", (event: FocusEvent) => {
      const mark = findClosestCommentMark(event.target);
      if (!mark) {
        return;
      }

      const related = event.relatedTarget;
      if (related instanceof Node && this.isInsideHoverSurface(related)) {
        return;
      }
      this.scheduleHideHoverSurfaces();
    });

    this.registerDomEvent(document, "pointerdown", (event: PointerEvent) => {
      if (!this.editPopoverEl?.hasClass("onc-visible")) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (this.editPopoverEl.contains(target)) {
        if (!(target instanceof Element) || !target.closest(".onc-style-picker")) {
          this.closeStylePickers();
        }
        return;
      }

      this.closeEditPopover();
    });

    this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.editPopoverEl?.hasClass("onc-visible")) {
        this.closeEditPopover();
      }
    });

    const handleViewportMove = (): void => {
      this.scheduleRepositionFloatingSurfaces();
    };
    window.addEventListener("resize", handleViewportMove);
    document.addEventListener("scroll", handleViewportMove, true);
    this.register(() => {
      window.removeEventListener("resize", handleViewportMove);
      document.removeEventListener("scroll", handleViewportMove, true);
      this.clearRepositionFrame();
    });

    for (const surface of [bottomSheetEl, inlinePopoverEl, editPopoverEl]) {
      this.registerDomEvent(surface, "pointerenter", () => {
        this.clearHideTimer();
      });
      this.registerDomEvent(surface, "pointerleave", () => {
        this.scheduleHideHoverSurfaces();
      });
    }
  }

  private showCommentForElement(sourceEl: HTMLElement): void {
    const id = sourceEl.getAttribute("data-onc-id");
    if (!id) {
      return;
    }

    const comment = this.getComment(id);
    if (comment) {
      sourceEl.setAttribute("data-onc-style", comment.styleId);
    }

    if (this.settings.displayMode === "inline-popover") {
      this.showInlinePopover(sourceEl, id, comment);
    } else {
      this.showBottomSheet(sourceEl, id, comment);
    }
  }

  private showBottomSheet(sourceEl: HTMLElement, id: string, comment: CommentRecord | null): void {
    if (!this.bottomSheetEl || !this.inlinePopoverEl) {
      return;
    }

    this.inlineAnchorEl = null;
    this.inlinePopoverEl.removeClass("onc-visible");
    this.renderHoverContent(this.bottomSheetEl, id, comment, sourceEl);
    this.bottomSheetEl.addClass("onc-visible");
  }

  private showInlinePopover(sourceEl: HTMLElement, id: string, comment: CommentRecord | null): void {
    if (!this.inlinePopoverEl || !this.bottomSheetEl) {
      return;
    }

    this.bottomSheetEl.removeClass("onc-visible");
    this.renderHoverContent(this.inlinePopoverEl, id, comment, sourceEl);
    this.inlinePopoverEl.addClass("onc-visible");
    this.inlineAnchorEl = sourceEl;
    this.positionInlinePopover(sourceEl);
  }

  private positionInlinePopover(sourceEl: HTMLElement): void {
    if (!this.inlinePopoverEl) {
      return;
    }

    this.positionFloatingElement(this.inlinePopoverEl, sourceEl, 8);
  }

  private positionFloatingElement(floatingEl: HTMLElement, sourceEl: HTMLElement, gap: number): void {
    const rect = sourceEl.getBoundingClientRect();
    this.positionFloatingElementAtRect(floatingEl, rect, gap);
  }

  private positionFloatingElementAtRect(floatingEl: HTMLElement, rect: DOMRect, gap: number): void {
    const popover = floatingEl;
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    popover.style.maxWidth = `${Math.min(360, viewportWidth - margin * 2)}px`;
    const popoverRect = popover.getBoundingClientRect();
    const width = popoverRect.width;
    const height = popoverRect.height;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

    let top = rect.bottom + gap;
    if (top + height > viewportHeight - margin) {
      top = rect.top - height - gap;
    }
    top = Math.max(margin, top);

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  private positionEditPopoverAtCenter(): void {
    if (!this.editPopoverEl) {
      return;
    }

    const rect = this.editPopoverEl.getBoundingClientRect();
    const margin = 12;
    this.editPopoverEl.style.left = `${Math.max(margin, window.innerWidth / 2 - rect.width / 2)}px`;
    this.editPopoverEl.style.top = `${Math.max(margin, window.innerHeight / 2 - rect.height / 2)}px`;
  }

  private renderHoverContent(
    container: HTMLElement,
    id: string,
    comment: CommentRecord | null,
    sourceEl: HTMLElement
  ): void {
    clearElement(container);

    const style = this.getStyle(comment?.styleId ?? sourceEl.getAttribute("data-onc-style"));

    const header = container.createDiv({ cls: "onc-comment-header" });
    header.createDiv({ cls: "onc-comment-style-name", text: style.name });
    if (comment) {
      header.createDiv({
        cls: "onc-comment-time",
        text: new Date(comment.updatedAt).toLocaleString()
      });
    }

    const quote = container.createDiv({ cls: "onc-comment-quote" });
    quote.setText(comment?.quote ?? sourceEl.innerText.trim());

    const body = container.createDiv({ cls: "onc-comment-body" });
    body.setText(comment?.comment ?? "未找到这条留言的数据。");

    const actions = container.createDiv({ cls: "onc-comment-actions" });

    if (comment) {
      const editButton = actions.createEl("button", {
        cls: "onc-comment-action onc-icon-button"
      });
      editButton.type = "button";
      editButton.setAttribute("aria-label", "编辑留言");
      editButton.setAttribute("title", "编辑留言");
      setIcon(editButton, "pencil");
      editButton.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.openEditCommentPopover(id, sourceEl);
      });
    }

    const deleteButton = actions.createEl("button", {
      cls: "onc-comment-action onc-icon-button onc-danger"
    });
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", comment ? "删除留言" : "移除标记");
    deleteButton.setAttribute("title", comment ? "删除留言" : "移除标记");
    setIcon(deleteButton, "trash-2");
    deleteButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.confirm(comment ? "确定删除这个标记和留言吗？" : "确定移除这个失效标记吗？")) {
        return;
      }
      void this.deleteComment(id, true);
    });
  }

  private prepareRenderedMarks(root: HTMLElement): void {
    const marks = root.querySelectorAll<HTMLElement>("span[data-onc-id]");
    for (const mark of Array.from(marks)) {
      const id = mark.getAttribute("data-onc-id");
      if (!id) {
        continue;
      }

      const comment = this.getComment(id);
      mark.addClass("onc-comment-mark");
      mark.setAttribute("data-onc-style", comment?.styleId ?? mark.getAttribute("data-onc-style") ?? this.settings.defaultStyleId);
      mark.setAttribute("tabindex", "0");
      mark.setAttribute("aria-label", "有留言的标记");
    }
  }

  private renderEditPopover(comment: CommentRecord): void {
    if (!this.editPopoverEl) {
      return;
    }

    clearElement(this.editPopoverEl);

    const styleRow = this.editPopoverEl.createDiv({ cls: "onc-edit-style-row" });
    this.renderStylePicker(styleRow, comment.styleId, (styleId) => {
      void this.updateCommentStyleFromEditPopover(comment.id, styleId);
    });

    const textarea = this.editPopoverEl.createEl("textarea", { cls: "onc-edit-textarea" });
    textarea.setAttribute("aria-label", "留言内容");
    textarea.placeholder = "写下你的留言或补充说明...";
    textarea.value = comment.comment;
    textarea.rows = 3;

    textarea.addEventListener("input", () => {
      comment.comment = textarea.value;
      comment.updatedAt = Date.now();
      this.autoResizeTextarea(textarea);
      this.scheduleEditSave();
    });
  }

  private renderCreatePopover(draft: CreateCommentDraft): void {
    if (!this.editPopoverEl) {
      return;
    }

    clearElement(this.editPopoverEl);

    const styleRow = this.editPopoverEl.createDiv({ cls: "onc-edit-style-row" });
    const stylePicker = this.renderStylePicker(styleRow, this.settings.defaultStyleId, () => {
      // New comments read the selected style when the user confirms the draft.
    });

    const actions = styleRow.createDiv({ cls: "onc-edit-style-actions" });
    const saveButton = actions.createEl("button", { cls: "onc-comment-action onc-icon-button" });
    saveButton.type = "button";
    saveButton.setAttribute("aria-label", "添加标记留言");
    saveButton.setAttribute("title", "添加标记留言");
    setIcon(saveButton, "check");

    const cancelButton = actions.createEl("button", { cls: "onc-comment-action onc-icon-button" });
    cancelButton.type = "button";
    cancelButton.setAttribute("aria-label", "取消");
    cancelButton.setAttribute("title", "取消");
    setIcon(cancelButton, "x");

    const textarea = this.editPopoverEl.createEl("textarea", { cls: "onc-edit-textarea" });
    textarea.setAttribute("aria-label", "留言内容");
    textarea.placeholder = "写下你的留言或补充说明...";
    textarea.rows = 3;

    const submit = async (): Promise<void> => {
      await this.createCommentFromDraft(draft, textarea.value, stylePicker.getValue());
    };

    saveButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    });

    cancelButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeEditPopover();
    });

    textarea.addEventListener("input", () => {
      this.autoResizeTextarea(textarea);
    });

    textarea.addEventListener("keydown", (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    });
  }

  private async createCommentFromDraft(draft: CreateCommentDraft, commentText: string, styleId: string): Promise<void> {
    const comment = commentText.trim();
    if (!comment) {
      new Notice("留言内容不能为空。");
      return;
    }

    const id = createCommentId();
    const now = Date.now();
    const resolvedStyleId = this.getStyle(styleId).id;

    this.settings.comments.push({
      id,
      filePath: draft.filePath,
      quote: draft.selectedText,
      comment,
      styleId: resolvedStyleId,
      createdAt: now,
      updatedAt: now
    });

    draft.editor.replaceRange(buildCommentMarkup(draft.selectedText, id, resolvedStyleId), draft.from, draft.to);
    await this.saveSettings();
    this.closeEditPopover();
    new Notice("已添加标记留言。");
  }

  private renderStylePicker(
    parentEl: HTMLElement,
    selectedStyleId: string,
    onChange: (styleId: string) => void
  ): StylePickerControl {
    let currentStyleId = this.getStyle(selectedStyleId).id;
    const wrapper = parentEl.createDiv({ cls: "onc-style-picker" });
    const trigger = wrapper.createEl("button", { cls: "onc-style-picker-trigger" });
    trigger.type = "button";
    trigger.setAttribute("aria-label", "标记样式");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const swatch = trigger.createSpan({ cls: "onc-style-picker-swatch" });
    const label = trigger.createSpan({ cls: "onc-style-picker-label" });
    const chevron = trigger.createSpan({ cls: "onc-style-picker-chevron" });
    setIcon(chevron, "chevron-down");

    const menu = wrapper.createDiv({ cls: "onc-style-picker-menu" });
    menu.setAttribute("role", "listbox");

    const close = (): void => {
      wrapper.removeClass("onc-open");
      trigger.setAttribute("aria-expanded", "false");
    };

    const updateTrigger = (): void => {
      const style = this.getStyle(currentStyleId);
      label.setText(style.name);
      swatch.style.backgroundColor = style.backgroundColor;
      swatch.style.borderColor = style.underlineColor;
      const options = menu.querySelectorAll<HTMLElement>(".onc-style-picker-option");
      for (const option of Array.from(options)) {
        option.toggleClass("is-selected", option.dataset.styleId === currentStyleId);
        option.setAttribute("aria-selected", option.dataset.styleId === currentStyleId ? "true" : "false");
      }
    };

    for (const style of this.settings.styles) {
      const option = menu.createEl("button", { cls: "onc-style-picker-option" });
      option.type = "button";
      option.dataset.styleId = style.id;
      option.setAttribute("role", "option");

      const optionSwatch = option.createSpan({ cls: "onc-style-picker-swatch" });
      optionSwatch.style.backgroundColor = style.backgroundColor;
      optionSwatch.style.borderColor = style.underlineColor;
      option.createSpan({ cls: "onc-style-picker-option-label", text: style.name });

      option.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        currentStyleId = style.id;
        updateTrigger();
        close();
        onChange(currentStyleId);
      });
    }

    trigger.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !wrapper.hasClass("onc-open");
      this.closeStylePickers();
      wrapper.toggleClass("onc-open", shouldOpen);
      trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    });

    updateTrigger();

    return {
      getValue: () => currentStyleId,
      close
    };
  }

  private async updateCommentStyleFromEditPopover(id: string, styleId: string): Promise<void> {
    const comment = this.getComment(id);
    if (!comment) {
      return;
    }

    const nextStyleId = this.getStyle(styleId).id;
    if (comment.styleId === nextStyleId) {
      return;
    }

    comment.styleId = nextStyleId;
    comment.updatedAt = Date.now();
    this.updateVisibleMarkStyle(id, nextStyleId);
    await this.rewriteCommentMarkup((markdown) => {
      return updateCommentSpanStyle(markdown, id, nextStyleId);
    }, comment.filePath);
    await this.saveSettings();
  }

  private updateVisibleMarkStyle(id: string, styleId: string): void {
    const selector = `.onc-comment-mark[data-onc-id="${cssAttributeValue(id)}"]`;
    const marks = document.querySelectorAll<HTMLElement>(selector);
    for (const mark of Array.from(marks)) {
      mark.setAttribute("data-onc-style", styleId);
    }
  }

  private findVisibleMarkElement(id: string): HTMLElement | null {
    const selector = `.onc-comment-mark[data-onc-id="${cssAttributeValue(id)}"]`;
    return this.app.workspace.containerEl.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
  }

  private getSelectionRange(): Range | null {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0).cloneRange();
      if (getVisibleRangeRect(range)) {
        return range;
      }
    }

    return null;
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    const maxHeight = Math.floor(window.innerHeight * 0.5);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  private scheduleEditSave(): void {
    if (this.editSaveTimer !== null) {
      window.clearTimeout(this.editSaveTimer);
    }

    this.editSaveTimer = window.setTimeout(() => {
      this.editSaveTimer = null;
      void this.saveSettings();
    }, 300);
  }

  private flushEditSave(): void {
    if (this.editSaveTimer === null) {
      return;
    }

    window.clearTimeout(this.editSaveTimer);
    this.editSaveTimer = null;
    void this.saveSettings();
  }

  private closeStylePickers(): void {
    const pickers = this.editPopoverEl?.querySelectorAll<HTMLElement>(".onc-style-picker.onc-open") ?? [];
    for (const picker of Array.from(pickers)) {
      picker.removeClass("onc-open");
      picker.querySelector("button")?.setAttribute("aria-expanded", "false");
    }
  }

  private refreshDynamicStyles(): void {
    if (!this.dynamicStyleEl) {
      this.dynamicStyleEl = document.createElement("style");
      this.dynamicStyleEl.setAttribute("data-onc-dynamic-styles", "true");
      document.head.appendChild(this.dynamicStyleEl);
    }

    this.dynamicStyleEl.textContent = this.settings.styles
      .map((style) => {
        const backgroundColor = safeCssColor(style.backgroundColor, "#fff3a3");
        const textColor = safeCssColor(style.textColor, "inherit");
        const underlineColor = safeCssColor(style.underlineColor, backgroundColor);
        const underlineStyle = safeUnderlineStyle(style.underlineStyle);
        const selector = `.onc-comment-mark[data-onc-style="${cssAttributeValue(style.id)}"]`;

        return `${selector} {
  background-color: ${backgroundColor};
  color: ${textColor};
  text-decoration-line: underline;
  text-decoration-style: ${underlineStyle};
  text-decoration-color: ${underlineColor};
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  box-shadow: inset 0 -0.16em 0 ${underlineColor};
}`;
      })
      .join("\n");
  }

  private async rewriteCommentMarkup(
    rewrite: (markdown: string) => string,
    filePath?: string
  ): Promise<boolean> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFilePath = activeView?.file?.path;
    const targetPath = filePath ?? activeFilePath;

    if (!targetPath) {
      return false;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(targetPath);
    const activeFile =
      activeView?.file && (activeFilePath === targetPath || !(abstractFile instanceof TFile))
        ? activeView.file
        : null;
    const canUseActiveEditor = Boolean(activeFile && activeView?.getMode() === "source");

    if (activeView && activeFile && canUseActiveEditor) {
      const editor = activeView.editor;
      const before = editor.getValue();
      const after = rewrite(before);
      if (after !== before) {
        const cursor = editor.getCursor();
        editor.setValue(after);
        try {
          editor.setCursor(cursor);
        } catch {
          // Cursor restoration can fail if the edited text shortened the document.
        }
        return true;
      }
      return false;
    }

    const fileToProcess = activeFile ?? (abstractFile instanceof TFile ? abstractFile : null);
    if (!fileToProcess) {
      return false;
    }

    let changed = false;
    await this.app.vault.process(fileToProcess, (markdown) => {
      const after = rewrite(markdown);
      changed = after !== markdown;
      return after;
    });
    return changed;
  }

  private hideHoverSurfaces(): void {
    this.inlineAnchorEl = null;
    this.bottomSheetEl?.removeClass("onc-visible");
    this.inlinePopoverEl?.removeClass("onc-visible");
  }

  private closeEditPopover(): void {
    this.flushEditSave();
    this.closeStylePickers();
    this.editAnchorEl = null;
    this.createAnchorRange = null;
    this.activeEditCommentId = null;
    this.editPopoverEl?.removeClass("onc-visible");
  }

  private scheduleRepositionFloatingSurfaces(): void {
    if (this.repositionFrame !== null) {
      return;
    }

    this.repositionFrame = window.requestAnimationFrame(() => {
      this.repositionFrame = null;
      this.repositionFloatingSurfaces();
    });
  }

  private repositionFloatingSurfaces(): void {
    if (this.inlinePopoverEl?.hasClass("onc-visible")) {
      if (this.inlineAnchorEl && this.inlineAnchorEl.isConnected && isElementInViewport(this.inlineAnchorEl)) {
        this.positionInlinePopover(this.inlineAnchorEl);
      } else {
        this.hideHoverSurfaces();
      }
    }

    if (!this.editPopoverEl?.hasClass("onc-visible")) {
      return;
    }

    if (this.createAnchorRange) {
      const rect = getVisibleRangeRect(this.createAnchorRange);
      if (rect) {
        this.positionFloatingElementAtRect(this.editPopoverEl, rect, 10);
      }
      return;
    }

    if ((!this.editAnchorEl || !this.editAnchorEl.isConnected) && this.activeEditCommentId) {
      this.editAnchorEl = this.findVisibleMarkElement(this.activeEditCommentId);
    }

    if (this.editAnchorEl && this.editAnchorEl.isConnected && isElementInViewport(this.editAnchorEl)) {
      this.positionFloatingElement(this.editPopoverEl, this.editAnchorEl, 10);
    }
  }

  private clearRepositionFrame(): void {
    if (this.repositionFrame !== null) {
      window.cancelAnimationFrame(this.repositionFrame);
      this.repositionFrame = null;
    }
  }

  private scheduleHideHoverSurfaces(): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.hideHoverSurfaces();
      this.hideTimer = null;
    }, 180);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private isInsideHoverSurface(node: Node): boolean {
    return Boolean(this.bottomSheetEl?.contains(node) || this.inlinePopoverEl?.contains(node));
  }
}

class NotesCommentsSettingTab extends PluginSettingTab {
  private readonly plugin: NotesCommentsPlugin;

  constructor(app: App, plugin: NotesCommentsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("onc-settings");
    containerEl.createEl("h2", { text: "Notes Comments" });

    new Setting(containerEl)
      .setName("留言展示方式")
      .setDesc("选择鼠标移动到标记文字时，留言框出现的位置。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("bottom-sheet", "底部中间滑出")
          .addOption("inline-popover", "标记处弹出")
          .setValue(this.plugin.settings.displayMode)
          .onChange(async (value) => {
            this.plugin.settings.displayMode = value as CommentDisplayMode;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("默认标记样式")
      .setDesc("新增标记留言时默认使用的样式。")
      .addDropdown((dropdown) => {
        for (const style of this.plugin.settings.styles) {
          dropdown.addOption(style.id, style.name);
        }
        dropdown.setValue(this.plugin.settings.defaultStyleId);
        dropdown.onChange(async (value) => {
          this.plugin.settings.defaultStyleId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("样式预设")
      .setDesc("可以调整预设颜色，也可以新增自己的样式。")
      .addButton((button) => {
        button
          .setButtonText("新增样式")
          .onClick(async () => {
            await this.plugin.addCustomStyle();
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("重置预设")
          .onClick(async () => {
            if (!window.confirm("确定重置所有样式预设吗？使用已删除样式的留言会回退到默认样式。")) {
              return;
            }
            await this.plugin.resetStyles();
            this.display();
          });
      });

    for (const style of this.plugin.settings.styles) {
      this.renderStyleEditor(containerEl, style);
    }
  }

  private renderStyleEditor(containerEl: HTMLElement, style: HighlightStyle): void {
    const section = containerEl.createDiv({ cls: "onc-style-editor" });
    section.createEl("h3", { text: style.name });

    new Setting(section)
      .setName("名称")
      .addText((text) => {
        text
          .setValue(style.name)
          .onChange(async (value) => {
            style.name = value.trim() || "未命名样式";
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName("背景色")
      .addColorPicker((picker) => {
        picker
          .setValue(style.backgroundColor)
          .onChange(async (value) => {
            style.backgroundColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName("文字色")
      .addColorPicker((picker) => {
        picker
          .setValue(normalizeColorPickerValue(style.textColor))
          .onChange(async (value) => {
            style.textColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName("下划线颜色")
      .addColorPicker((picker) => {
        picker
          .setValue(style.underlineColor)
          .onChange(async (value) => {
            style.underlineColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName("下划线样式")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("solid", "实线")
          .addOption("dotted", "点线")
          .addOption("dashed", "虚线")
          .addOption("wavy", "波浪线")
          .setValue(style.underlineStyle)
          .onChange(async (value) => {
            style.underlineStyle = safeUnderlineStyle(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName("删除这个样式")
      .setDesc("使用这个样式的留言会切换到其他可用样式。")
      .addButton((button) => {
        button
          .setButtonText("删除")
          .setWarning()
          .onClick(async () => {
            if (!window.confirm(`确定删除「${style.name}」吗？`)) {
              return;
            }
            await this.plugin.removeStyle(style.id);
            this.display();
          });
      });
  }
}

function createCommentHighlightExtension(plugin: NotesCommentsPlugin) {
  class CommentHighlightViewPlugin {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildCommentDecorations(view, plugin);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildCommentDecorations(update.view, plugin);
      }
    }
  }

  return ViewPlugin.fromClass(CommentHighlightViewPlugin, {
    decorations: (value: CommentHighlightViewPlugin) => value.decorations
  });
}

function buildCommentDecorations(view: EditorView, plugin: NotesCommentsPlugin): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const markdown = view.state.doc.toString();

  for (const span of findAllCommentSpans(markdown)) {
    if (span.contentTo <= span.contentFrom) {
      continue;
    }

    const comment = plugin.getComment(span.id);
    const styleId = comment?.styleId ?? span.styleId ?? plugin.settings.defaultStyleId;
    builder.add(
      span.contentFrom,
      span.contentTo,
      Decoration.mark({
        class: "onc-comment-mark onc-editor-comment-mark",
        attributes: {
          "data-onc-id": span.id,
          "data-onc-style": styleId,
          "aria-label": "有留言的标记"
        }
      })
    );
  }

  return builder.finish();
}

function findAllCommentSpans(markdown: string): CommentSpanMatch[] {
  const spans: CommentSpanMatch[] = [];
  const regex = createCommentSpanRegex();
  let match = regex.exec(markdown);

  while (match) {
    const full = match[0];
    const attrs = match[1] ?? "";
    const id = readAttribute(attrs, "data-onc-id");

    if (id) {
      const openingTagEnd = full.indexOf(">") + 1;
      const closingTagStart = full.lastIndexOf("</span>");
      const from = match.index;
      const to = match.index + full.length;

      spans.push({
        id,
        styleId: readAttribute(attrs, "data-onc-style"),
        from,
        to,
        contentFrom: from + openingTagEnd,
        contentTo: from + closingTagStart
      });
    }

    match = regex.exec(markdown);
  }

  return spans;
}

function findCommentSpanAtOffset(markdown: string, offset: number): CommentSpanMatch | null {
  return findAllCommentSpans(markdown).find((span) => offset >= span.from && offset <= span.to) ?? null;
}

function buildCommentMarkup(selectedText: string, id: string, styleId: string): string {
  return `<span class="onc-comment-mark" data-onc-id="${escapeHtmlAttribute(id)}" data-onc-style="${escapeHtmlAttribute(styleId)}">${selectedText}</span>`;
}

function unwrapCommentMarkup(markdown: string, id: string): string {
  return markdown.replace(createCommentSpanRegex(), (full: string, attrs: string, inner: string) => {
    if (readAttribute(attrs, "data-onc-id") !== id) {
      return full;
    }
    return inner;
  });
}

function updateCommentSpanStyle(markdown: string, id: string, styleId: string): string {
  return markdown.replace(createCommentSpanRegex(), (full: string, attrs: string, inner: string) => {
    if (readAttribute(attrs, "data-onc-id") !== id) {
      return full;
    }

    const attrsWithClass = ensureClassAttribute(attrs, "onc-comment-mark");
    const updatedAttrs = setAttribute(attrsWithClass, "data-onc-style", styleId);
    return `<span${updatedAttrs}>${inner}</span>`;
  });
}

function createCommentSpanRegex(): RegExp {
  return /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
}

function readAttribute(attrs: string, name: string): string | null {
  const escapedName = escapeRegExp(name);
  const match = attrs.match(new RegExp(`${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function setAttribute(attrs: string, name: string, value: string): string {
  const escapedName = escapeRegExp(name);
  const attrRegex = new RegExp(`(\\s${escapedName}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, "i");
  const escapedValue = escapeHtmlAttribute(value);

  if (attrRegex.test(attrs)) {
    return attrs.replace(attrRegex, (_match: string, prefix: string) => `${prefix}"${escapedValue}"`);
  }

  return `${attrs} ${name}="${escapedValue}"`;
}

function ensureClassAttribute(attrs: string, className: string): string {
  const classRegex = /(\sclass\s*=\s*)(?:"([^"]*)"|'([^']*)')/i;
  const match = attrs.match(classRegex);

  if (!match) {
    return `${attrs} class="${escapeHtmlAttribute(className)}"`;
  }

  const currentValue = match[2] ?? match[3] ?? "";
  const classes = currentValue.split(/\s+/).filter(Boolean);
  if (classes.includes(className)) {
    return attrs;
  }

  const updatedValue = [...classes, className].join(" ");
  return attrs.replace(classRegex, (_match: string, prefix: string) => `${prefix}"${escapeHtmlAttribute(updatedValue)}"`);
}

function createCommentId(): string {
  return `onc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStyles(styles: HighlightStyle[] | undefined): HighlightStyle[] {
  const source = Array.isArray(styles) && styles.length > 0 ? styles : DEFAULT_STYLES;
  const normalized = source
    .filter((style) => typeof style.id === "string" && style.id.trim())
    .map((style) => ({
      id: style.id,
      name: style.name?.trim() || "未命名样式",
      backgroundColor: normalizeColorPickerValue(style.backgroundColor),
      textColor: normalizeColorPickerValue(style.textColor),
      underlineColor: normalizeColorPickerValue(style.underlineColor),
      underlineStyle: safeUnderlineStyle(style.underlineStyle)
    }));

  return normalized.length > 0 ? normalized : cloneStyles(DEFAULT_STYLES);
}

function normalizeComments(comments: CommentRecord[] | undefined, defaultStyleId: string): CommentRecord[] {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments
    .filter((comment) => typeof comment.id === "string" && typeof comment.comment === "string")
    .map((comment) => ({
      id: comment.id,
      filePath: comment.filePath ?? "",
      quote: comment.quote ?? "",
      comment: comment.comment,
      styleId: comment.styleId ?? defaultStyleId,
      createdAt: comment.createdAt ?? Date.now(),
      updatedAt: comment.updatedAt ?? comment.createdAt ?? Date.now()
    }));
}

function cloneStyles(styles: HighlightStyle[]): HighlightStyle[] {
  return styles.map((style) => ({ ...style }));
}

function normalizeColorPickerValue(value: string | undefined): string {
  if (!value) {
    return "#000000";
  }

  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : "#000000";
}

function safeCssColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^rgba?\([\d\s.,%]+\)$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^hsla?\([\d\s.,%]+\)$/i.test(trimmed)) {
    return trimmed;
  }
  if (["transparent", "inherit", "currentColor"].includes(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function safeUnderlineStyle(value: string): UnderlineStyle {
  if (value === "dotted" || value === "dashed" || value === "wavy") {
    return value;
  }
  return "solid";
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findClosestCommentMark(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(".onc-comment-mark[data-onc-id]");
}

function getVisibleRangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if ((rect.width > 0 || rect.height > 0) && isRectInViewport(rect)) {
    return rect;
  }
  return null;
}

function isElementInViewport(element: HTMLElement): boolean {
  return isRectInViewport(element.getBoundingClientRect());
}

function isRectInViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

function clearElement(element: HTMLElement): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
