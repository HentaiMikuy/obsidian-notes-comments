import {
  App,
  Editor,
  EditorPosition,
  EventRef,
  MarkdownFileInfo,
  MarkdownRenderer,
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

type CommentDisplayMode = "bottom-sheet" | "inline-popover" | "right-side";
type UnderlineStyle = "solid" | "dotted" | "dashed" | "wavy";
type Language = "zh" | "en";

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
  threadId: string;
  filePath: string;
  quote: string;
  comment: string;
  authorName: string;
  styleId: string;
  createdAt: number;
  updatedAt: number;
}

interface NotesCommentsSettings {
  language: Language;
  displayMode: CommentDisplayMode;
  defaultStyleId: string;
  commenterName: string;
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

interface DropdownOption {
  value: string;
  label: string;
  swatchColor?: string;
  swatchBorderColor?: string;
}

type RegisterEditorMenuEvent = (
  name: "editor-menu",
  callback: (menu: Menu, editor: Editor, view: MarkdownView) => void
) => EventRef;

const DEFAULT_STYLE_ID = "yellow-marker";
const DEFAULT_LANGUAGE: Language = "zh";

const ZH_TRANSLATIONS = {
  addHighlightComment: "添加标记留言",
  editCursorComment: "编辑光标处的标记留言",
  removeCursorComment: "删除光标处的标记留言",
  editHighlightComment: "编辑标记留言",
  removeHighlightComment: "删除标记留言",
  customStyleName: "自定义样式",
  untitledStyleName: "未命名样式",
  keepOneStyleNotice: "至少需要保留一个标记样式。",
  selectTextNotice: "请先选中需要标记的文字。",
  unsafeSpanNotice: "选区包含 </span>，暂时无法安全添加标记。",
  noWritableMarkdownNotice: "当前没有可写入的 Markdown 文件。",
  cursorNotInCommentNotice: "光标不在标记留言中。",
  confirmDeleteMarkAndComment: "确定删除这个标记和留言吗？",
  commentDataNotFound: "未找到这条留言的数据。",
  deletedDataMarkMissingNotice: "已删除留言数据，但没有找到正文标记。",
  deletedMarkedCommentNotice: "已删除标记留言。",
  deletedCommentNotice: "已删除这条留言。",
  unknownNote: "未知备注",
  addReply: "追加留言",
  deleteThread: "删除整个标记线程",
  removeMark: "移除标记",
  confirmDeleteThread: "确定删除这个标记和全部留言吗？",
  confirmRemoveInvalidMark: "确定移除这个失效标记吗？",
  editThisComment: "编辑这条留言",
  deleteThisComment: "删除这条留言",
  confirmDeleteComment: "确定删除这条留言吗？如果这是最后一条留言，会同时移除正文标记。",
  replyContent: "追加留言内容",
  replyPlaceholder: "继续补充这个标记处的留言...",
  saveReply: "保存追加留言",
  cancel: "取消",
  commentMarkWithComments: "有留言的标记",
  emptyComment: "留言内容为空。",
  editComment: "编辑留言",
  doneEditing: "完成编辑",
  commentContent: "留言内容",
  commentPlaceholder: "写下你的留言或补充说明...",
  emptyCommentNotice: "留言内容不能为空。",
  addedCommentNotice: "已添加标记留言。",
  markCommentDataNotFoundNotice: "未找到这个标记的留言数据。",
  addedReplyNotice: "已追加留言。",
  authorName: "备注人名称",
  authorPlaceholderPrefix: "备注人",
  markStyle: "标记样式",
  settingLanguageName: "语言",
  settingLanguageDesc: "选择插件界面显示语言。",
  languageZh: "中文",
  languageEn: "English",
  settingDisplayModeName: "留言展示方式",
  settingDisplayModeDesc: "选择鼠标移动到标记文字时，留言框出现的位置。",
  displayModeBottomSheet: "底部中间滑出",
  displayModeInlinePopover: "标记处弹出",
  displayModeRightSide: "中间右侧滑出",
  settingDefaultAuthorName: "默认备注人名称",
  settingDefaultAuthorDesc: "新增或编辑留言时，如果备注人名称留空，就使用这个名称。",
  settingDefaultStyleName: "默认标记样式",
  settingDefaultStyleDesc: "新增标记留言时默认使用的样式。",
  settingStylesName: "样式预设",
  settingStylesDesc: "可以调整预设颜色，也可以新增自己的样式。",
  addStyle: "新增样式",
  resetStyles: "重置预设",
  confirmResetStyles: "确定重置所有样式预设吗？使用已删除样式的留言会回退到默认样式。",
  styleName: "名称",
  backgroundColor: "背景色",
  textColor: "文字色",
  underlineColor: "下划线颜色",
  underlineStyle: "下划线样式",
  underlineSolid: "实线",
  underlineDotted: "点线",
  underlineDashed: "虚线",
  underlineWavy: "波浪线",
  deleteStyle: "删除这个样式",
  deleteStyleDesc: "使用这个样式的留言会切换到其他可用样式。",
  delete: "删除",
  confirmDeleteStylePrefix: "确定删除「",
  confirmDeleteStyleSuffix: "」吗？",
  styleYellowMarker: "黄色荧光",
  styleBlueNote: "蓝色批注",
  styleGreenDotted: "绿色虚线",
  styleRoseWavy: "玫瑰波浪"
} as const;

type TranslationKey = keyof typeof ZH_TRANSLATIONS;

const EN_TRANSLATIONS: Record<TranslationKey, string> = {
  addHighlightComment: "Add highlighted comment",
  editCursorComment: "Edit comment at cursor",
  removeCursorComment: "Remove comment at cursor",
  editHighlightComment: "Edit highlighted comment",
  removeHighlightComment: "Remove highlighted comment",
  customStyleName: "Custom style",
  untitledStyleName: "Untitled style",
  keepOneStyleNotice: "Keep at least one highlight style.",
  selectTextNotice: "Select the text you want to highlight first.",
  unsafeSpanNotice: "The selection contains </span>, so a highlight cannot be added safely.",
  noWritableMarkdownNotice: "There is no writable Markdown file right now.",
  cursorNotInCommentNotice: "The cursor is not inside a highlighted comment.",
  confirmDeleteMarkAndComment: "Delete this highlight and its comment?",
  commentDataNotFound: "Comment data was not found.",
  deletedDataMarkMissingNotice: "Deleted the comment data, but could not find the text highlight.",
  deletedMarkedCommentNotice: "Deleted the highlighted comment.",
  deletedCommentNotice: "Deleted this comment.",
  unknownNote: "Unknown note",
  addReply: "Add reply",
  deleteThread: "Delete the full highlight thread",
  removeMark: "Remove highlight",
  confirmDeleteThread: "Delete this highlight and all comments?",
  confirmRemoveInvalidMark: "Remove this invalid highlight?",
  editThisComment: "Edit this comment",
  deleteThisComment: "Delete this comment",
  confirmDeleteComment: "Delete this comment? If it is the last comment, the text highlight will also be removed.",
  replyContent: "Reply content",
  replyPlaceholder: "Add another note for this highlight...",
  saveReply: "Save reply",
  cancel: "Cancel",
  commentMarkWithComments: "Highlight with comments",
  emptyComment: "Comment content is empty.",
  editComment: "Edit comment",
  doneEditing: "Done editing",
  commentContent: "Comment content",
  commentPlaceholder: "Write your comment or supplemental note...",
  emptyCommentNotice: "Comment content cannot be empty.",
  addedCommentNotice: "Added highlighted comment.",
  markCommentDataNotFoundNotice: "Comment data for this highlight was not found.",
  addedReplyNotice: "Added reply.",
  authorName: "Author name",
  authorPlaceholderPrefix: "Author",
  markStyle: "Highlight style",
  settingLanguageName: "Language",
  settingLanguageDesc: "Choose the plugin interface language.",
  languageZh: "中文",
  languageEn: "English",
  settingDisplayModeName: "Comment display mode",
  settingDisplayModeDesc: "Choose where comments appear when hovering highlighted text.",
  displayModeBottomSheet: "Bottom sheet",
  displayModeInlinePopover: "Inline popover",
  displayModeRightSide: "Right side panel",
  settingDefaultAuthorName: "Default author name",
  settingDefaultAuthorDesc: "Used when the author field is empty while adding or editing comments.",
  settingDefaultStyleName: "Default highlight style",
  settingDefaultStyleDesc: "Used by default when adding highlighted comments.",
  settingStylesName: "Style presets",
  settingStylesDesc: "Adjust preset colors or add your own styles.",
  addStyle: "Add style",
  resetStyles: "Reset presets",
  confirmResetStyles: "Reset all style presets? Comments using deleted styles will fall back to the default style.",
  styleName: "Name",
  backgroundColor: "Background color",
  textColor: "Text color",
  underlineColor: "Underline color",
  underlineStyle: "Underline style",
  underlineSolid: "Solid",
  underlineDotted: "Dotted",
  underlineDashed: "Dashed",
  underlineWavy: "Wavy",
  deleteStyle: "Delete this style",
  deleteStyleDesc: "Comments using this style will switch to another available style.",
  delete: "Delete",
  confirmDeleteStylePrefix: "Delete \"",
  confirmDeleteStyleSuffix: "\"?",
  styleYellowMarker: "Yellow highlight",
  styleBlueNote: "Blue note",
  styleGreenDotted: "Green dotted",
  styleRoseWavy: "Rose wavy"
};

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = {
  zh: ZH_TRANSLATIONS,
  en: EN_TRANSLATIONS
};

const DEFAULT_STYLE_NAME_KEYS: Record<string, TranslationKey> = {
  "yellow-marker": "styleYellowMarker",
  "blue-note": "styleBlueNote",
  "green-dotted": "styleGreenDotted",
  "rose-wavy": "styleRoseWavy"
};

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
  language: DEFAULT_LANGUAGE,
  displayMode: "bottom-sheet",
  defaultStyleId: DEFAULT_STYLE_ID,
  commenterName: "Note Taker",
  styles: createDefaultStyles(DEFAULT_LANGUAGE),
  comments: []
};

export default class NotesCommentsPlugin extends Plugin {
  settings: NotesCommentsSettings = DEFAULT_SETTINGS;
  private bottomSheetEl: HTMLElement | null = null;
  private inlinePopoverEl: HTMLElement | null = null;
  private rightPanelEl: HTMLElement | null = null;
  private editPopoverEl: HTMLElement | null = null;
  private dynamicStyleEl: HTMLStyleElement | null = null;
  private inlineAnchorEl: HTMLElement | null = null;
  private editAnchorEl: HTMLElement | null = null;
  private createAnchorRange: Range | null = null;
  private activeEditThreadId: string | null = null;
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

    this.registerCommands();
    this.addSettingTab(new NotesCommentsSettingTab(this.app, this));
  }

  refreshCommands(): void {
    this.removeCommand("add-highlight-comment");
    this.removeCommand("edit-highlight-comment-at-cursor");
    this.removeCommand("remove-highlight-comment-at-cursor");
    this.registerCommands();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "add-highlight-comment",
      name: this.t("addHighlightComment"),
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        this.openCreateCommentPopover(editor, ctx);
      }
    });

    this.addCommand({
      id: "edit-highlight-comment-at-cursor",
      name: this.t("editCursorComment"),
      editorCallback: (editor: Editor) => {
        this.openEditCommentAtCursor(editor);
      }
    });

    this.addCommand({
      id: "remove-highlight-comment-at-cursor",
      name: this.t("removeCursorComment"),
      editorCallback: (editor: Editor) => {
        void this.removeCommentAtCursor(editor);
      }
    });
  }

  private registerEditorContextMenu(): void {
    const onEditorMenu = this.app.workspace.on.bind(this.app.workspace) as unknown as RegisterEditorMenuEvent;

    this.registerEvent(
      onEditorMenu("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
        if (editor.getSelection().trim()) {
          menu.addItem((item) => {
            item
              .setTitle(this.t("addHighlightComment"))
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
            .setTitle(this.t("editHighlightComment"))
            .setIcon("pencil")
            .onClick(() => {
              this.openEditCommentPopover(span.id, null, true);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle(this.t("removeHighlightComment"))
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

    const language = normalizeLanguage(loaded?.language);
    const styles = normalizeStyles(loaded?.styles, language);
    const loadedDefaultStyleId = typeof loaded?.defaultStyleId === "string" ? loaded.defaultStyleId : undefined;
    const fallbackStyleId = styles[0]?.id ?? DEFAULT_STYLE_ID;
    const defaultStyleId: string =
      loadedDefaultStyleId && styles.some((style) => style.id === loadedDefaultStyleId)
        ? loadedDefaultStyleId
        : fallbackStyleId;
    const commenterName = normalizeCommenterName(loaded?.commenterName);

    this.settings = {
      language,
      displayMode: normalizeDisplayMode(loaded?.displayMode),
      defaultStyleId,
      commenterName,
      styles,
      comments: normalizeComments(loaded?.comments, defaultStyleId, commenterName)
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshDynamicStyles();
  }

  t(key: TranslationKey): string {
    return translate(this.settings.language, key);
  }

  getStyleDisplayName(style: HighlightStyle): string {
    return getStyleDisplayName(style, this.settings.language);
  }

  getCommentCountLabel(count: number): string {
    return this.settings.language === "en" ? `${count} ${count === 1 ? "comment" : "comments"}` : `${count} 条留言`;
  }

  getCommentMarkAriaLabel(commentCount: number): string {
    if (this.settings.language === "en") {
      return commentCount > 1
        ? `Highlight with ${commentCount} comments`
        : this.t("commentMarkWithComments");
    }

    return commentCount > 1 ? `有 ${commentCount} 条留言的标记` : this.t("commentMarkWithComments");
  }

  getComment(id: string): CommentRecord | null {
    return this.settings.comments.find((comment) => comment.id === id) ?? null;
  }

  getThreadComments(threadId: string): CommentRecord[] {
    return this.settings.comments
      .filter((comment) => getCommentThreadId(comment) === threadId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getThreadPrimaryComment(threadId: string): CommentRecord | null {
    return this.getThreadComments(threadId)[0] ?? null;
  }

  getThreadLatestComment(threadId: string): CommentRecord | null {
    const comments = this.getThreadComments(threadId);
    return comments[comments.length - 1] ?? null;
  }

  getThreadStyleId(threadId: string, fallbackStyleId?: string | null): string {
    return this.getStyle(this.getThreadPrimaryComment(threadId)?.styleId ?? fallbackStyleId ?? this.settings.defaultStyleId).id;
  }

  getStyle(styleId: string | null | undefined): HighlightStyle {
    return (
      this.settings.styles.find((style) => style.id === styleId) ??
      this.settings.styles.find((style) => style.id === this.settings.defaultStyleId) ??
      this.settings.styles[0] ??
      DEFAULT_STYLES[0]
    );
  }

  getCommentAuthorName(comment: CommentRecord): string {
    return resolveCommenterName(comment.authorName, this.settings.commenterName);
  }

  async addCustomStyle(): Promise<void> {
    const id = `custom-${Date.now().toString(36)}`;
    this.settings.styles.push({
      id,
      name: this.t("customStyleName"),
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
      new Notice(this.t("keepOneStyleNotice"));
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
    this.settings.styles = createDefaultStyles(this.settings.language);
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
      new Notice(this.t("selectTextNotice"));
      return;
    }

    if (selectedText.includes("</span>")) {
      new Notice(this.t("unsafeSpanNotice"));
      return;
    }

    const filePath = view.file?.path;
    if (!filePath) {
      new Notice(this.t("noWritableMarkdownNotice"));
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

    this.activeEditThreadId = null;
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
      new Notice(this.t("cursorNotInCommentNotice"));
      return;
    }

    this.openEditCommentPopover(span.id, null, true);
  }

  async removeCommentAtCursor(editor: Editor): Promise<void> {
    const span = findCommentSpanAtOffset(editor.getValue(), editor.posToOffset(editor.getCursor()));
    if (!span) {
      new Notice(this.t("cursorNotInCommentNotice"));
      return;
    }

    if (!window.confirm(this.t("confirmDeleteMarkAndComment"))) {
      return;
    }

    await this.deleteCommentThread(span.id, true);
  }

  openEditCommentPopover(id: string, sourceEl?: HTMLElement | null, preferThreadLatest = false): void {
    const threadLatestComment = this.getThreadLatestComment(id);
    const comment = preferThreadLatest && threadLatestComment ? threadLatestComment : this.getComment(id) ?? threadLatestComment;
    if (!comment) {
      new Notice(this.t("commentDataNotFound"));
      return;
    }

    const threadId = getCommentThreadId(comment);
    const anchorEl = sourceEl ?? this.findVisibleMarkElement(threadId);
    if (!this.editPopoverEl) {
      return;
    }

    this.hideHoverSurfaces();
    this.renderEditPopover(comment);
    this.editPopoverEl.addClass("onc-visible");
    this.activeEditThreadId = threadId;
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

  async deleteCommentThread(threadId: string, unwrapMarkup: boolean): Promise<void> {
    const comments = this.getThreadComments(threadId);
    const filePath = comments[0]?.filePath;
    let markupChanged = false;

    if (unwrapMarkup) {
      markupChanged = await this.rewriteCommentMarkup((markdown) => unwrapCommentMarkup(markdown, threadId), filePath);
    }

    this.settings.comments = this.settings.comments.filter((record) => getCommentThreadId(record) !== threadId);
    await this.saveSettings();
    this.hideHoverSurfaces();
    new Notice(unwrapMarkup && !markupChanged ? this.t("deletedDataMarkMissingNotice") : this.t("deletedMarkedCommentNotice"));
  }

  async deleteCommentMessage(commentId: string, unwrapWhenThreadEmpty: boolean): Promise<boolean> {
    const comment = this.getComment(commentId);
    if (!comment) {
      return false;
    }

    const threadId = getCommentThreadId(comment);
    const remaining = this.getThreadComments(threadId).filter((record) => record.id !== commentId);
    let markupChanged = false;

    if (remaining.length === 0 && unwrapWhenThreadEmpty) {
      markupChanged = await this.rewriteCommentMarkup((markdown) => unwrapCommentMarkup(markdown, threadId), comment.filePath);
    }

    this.settings.comments = this.settings.comments.filter((record) => record.id !== commentId);
    await this.saveSettings();

    if (remaining.length === 0) {
      this.hideHoverSurfaces();
      new Notice(unwrapWhenThreadEmpty && !markupChanged ? this.t("deletedDataMarkMissingNotice") : this.t("deletedMarkedCommentNotice"));
    } else {
      new Notice(this.t("deletedCommentNotice"));
    }

    return true;
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

    const rightPanelEl = document.createElement("div");
    rightPanelEl.className = "onc-right-panel";
    document.body.appendChild(rightPanelEl);
    this.rightPanelEl = rightPanelEl;

    const editPopoverEl = document.createElement("div");
    editPopoverEl.className = "onc-edit-popover";
    document.body.appendChild(editPopoverEl);
    this.editPopoverEl = editPopoverEl;

    this.register(() => {
      this.bottomSheetEl?.remove();
      this.inlinePopoverEl?.remove();
      this.rightPanelEl?.remove();
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
      const editPopoverVisible = this.editPopoverEl?.hasClass("onc-visible") ?? false;
      const bottomSheetVisible = this.bottomSheetEl?.hasClass("onc-visible") ?? false;
      const rightPanelVisible = this.rightPanelEl?.hasClass("onc-visible") ?? false;
      if (!editPopoverVisible && !bottomSheetVisible && !rightPanelVisible) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (this.editPopoverEl?.contains(target)) {
        if (!(target instanceof Element) || !target.closest(".onc-style-picker")) {
          this.closeStylePickers();
        }
        return;
      }

      if (this.bottomSheetEl?.hasClass("onc-visible") && this.bottomSheetEl.contains(target)) {
        if (!(target instanceof Element) || !target.closest(".onc-style-picker")) {
          this.closeStylePickers();
        }
        return;
      }

      if (this.rightPanelEl?.hasClass("onc-visible") && this.rightPanelEl.contains(target)) {
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

    for (const surface of [bottomSheetEl, inlinePopoverEl, rightPanelEl, editPopoverEl]) {
      this.registerDomEvent(surface, "pointerenter", () => {
        this.clearHideTimer();
      });
      this.registerDomEvent(surface, "pointerleave", () => {
        this.scheduleHideHoverSurfaces();
      });
    }
  }

  private showCommentForElement(sourceEl: HTMLElement): void {
    const threadId = sourceEl.getAttribute("data-onc-id");
    if (!threadId) {
      return;
    }

    const comments = this.getThreadComments(threadId);
    if (comments.length > 0) {
      sourceEl.setAttribute("data-onc-style", this.getThreadStyleId(threadId, sourceEl.getAttribute("data-onc-style")));
    }

    if (this.settings.displayMode === "inline-popover") {
      this.showInlinePopover(sourceEl, threadId, comments);
    } else if (this.settings.displayMode === "right-side") {
      this.showRightPanel(sourceEl, threadId, comments);
    } else {
      this.showBottomSheet(sourceEl, threadId, comments);
    }
  }

  private showBottomSheet(sourceEl: HTMLElement, threadId: string, comments: CommentRecord[]): void {
    if (!this.bottomSheetEl || !this.inlinePopoverEl || !this.rightPanelEl) {
      return;
    }

    this.inlineAnchorEl = null;
    this.inlinePopoverEl.removeClass("onc-visible");
    this.rightPanelEl.removeClass("onc-visible");
    this.renderHoverContent(this.bottomSheetEl, threadId, comments, sourceEl);
    this.bottomSheetEl.addClass("onc-visible");
  }

  private showInlinePopover(sourceEl: HTMLElement, threadId: string, comments: CommentRecord[]): void {
    if (!this.inlinePopoverEl || !this.bottomSheetEl || !this.rightPanelEl) {
      return;
    }

    this.bottomSheetEl.removeClass("onc-visible");
    this.rightPanelEl.removeClass("onc-visible");
    this.renderHoverContent(this.inlinePopoverEl, threadId, comments, sourceEl);
    this.inlinePopoverEl.addClass("onc-visible");
    this.inlineAnchorEl = sourceEl;
    this.positionInlinePopover(sourceEl);
  }

  private showRightPanel(sourceEl: HTMLElement, threadId: string, comments: CommentRecord[]): void {
    if (!this.rightPanelEl || !this.bottomSheetEl || !this.inlinePopoverEl) {
      return;
    }

    this.inlineAnchorEl = null;
    this.bottomSheetEl.removeClass("onc-visible");
    this.inlinePopoverEl.removeClass("onc-visible");
    this.renderHoverContent(this.rightPanelEl, threadId, comments, sourceEl);
    this.rightPanelEl.addClass("onc-visible");
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
    threadId: string,
    comments: CommentRecord[],
    sourceEl: HTMLElement
  ): void {
    clearElement(container);

    const latestComment = comments[comments.length - 1] ?? null;

    const header = container.createDiv({ cls: "onc-comment-header" });
    header.createDiv({ cls: "onc-comment-style-name", text: latestComment ? this.getCommentCountLabel(comments.length) : this.t("unknownNote") });
    if (latestComment) {
      header.createDiv({
        cls: "onc-comment-time",
        text: new Date(latestComment.updatedAt).toLocaleString()
      });
    }

    if (comments.length === 0) {
      const body = container.createDiv({ cls: "onc-comment-body" });
      this.renderCommentMarkdown(body, null);
    } else {
      const thread = container.createDiv({ cls: "onc-comment-thread" });
      for (const comment of comments) {
        this.renderCommentMessage(container, thread, threadId, comment, sourceEl);
      }
    }

    const actions = container.createDiv({ cls: "onc-comment-actions" });

    if (comments.length > 0) {
      const replyButton = actions.createEl("button", {
        cls: "onc-comment-action onc-icon-button"
      });
      replyButton.type = "button";
      replyButton.setAttribute("aria-label", this.t("addReply"));
      replyButton.setAttribute("title", this.t("addReply"));
      setIcon(replyButton, "message-square-plus");
      replyButton.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.renderReplyContent(container, threadId, sourceEl);
      });
    }

    const deleteButton = actions.createEl("button", {
      cls: "onc-comment-action onc-icon-button onc-danger"
    });
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", comments.length > 0 ? this.t("deleteThread") : this.t("removeMark"));
    deleteButton.setAttribute("title", comments.length > 0 ? this.t("deleteThread") : this.t("removeMark"));
    setIcon(deleteButton, "trash-2");
    deleteButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.confirm(comments.length > 0 ? this.t("confirmDeleteThread") : this.t("confirmRemoveInvalidMark"))) {
        return;
      }
      void this.deleteCommentThread(threadId, true);
    });
  }

  private renderCommentMessage(
    container: HTMLElement,
    threadEl: HTMLElement,
    threadId: string,
    comment: CommentRecord,
    sourceEl: HTMLElement
  ): void {
    const message = threadEl.createDiv({ cls: "onc-comment-message" });
    const meta = message.createDiv({ cls: "onc-comment-message-meta" });
    const authorName = this.getCommentAuthorName(comment);
    const authorEl = meta.createSpan({ cls: "onc-comment-message-author", text: authorName });
    authorEl.setAttribute("title", authorName);
    meta.createSpan({
      cls: "onc-comment-message-time",
      text: new Date(comment.updatedAt).toLocaleString()
    });

    const messageActions = meta.createDiv({ cls: "onc-comment-message-actions" });
    const editButton = messageActions.createEl("button", {
      cls: "onc-comment-action onc-icon-button"
    });
    editButton.type = "button";
    editButton.setAttribute("aria-label", this.t("editThisComment"));
    editButton.setAttribute("title", this.t("editThisComment"));
    setIcon(editButton, "pencil");
    editButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (
        (container === this.bottomSheetEl && this.settings.displayMode === "bottom-sheet") ||
        (container === this.rightPanelEl && this.settings.displayMode === "right-side")
      ) {
        this.renderPanelEditContent(container, threadId, comment, sourceEl);
      } else {
        this.openEditCommentPopover(comment.id, sourceEl);
      }
    });

    const deleteButton = messageActions.createEl("button", {
      cls: "onc-comment-action onc-icon-button onc-danger"
    });
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", this.t("deleteThisComment"));
    deleteButton.setAttribute("title", this.t("deleteThisComment"));
    setIcon(deleteButton, "trash-2");
    deleteButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.confirm(this.t("confirmDeleteComment"))) {
        return;
      }
      void this.deleteCommentMessage(comment.id, true).then((deleted) => {
        const remaining = this.getThreadComments(threadId);
        if (deleted && remaining.length > 0 && container.isConnected) {
          this.renderHoverContent(container, threadId, remaining, sourceEl);
        }
      });
    });

    const body = message.createDiv({ cls: "onc-comment-body onc-comment-message-body" });
    this.renderCommentMarkdown(body, comment);
  }

  private renderReplyContent(container: HTMLElement, threadId: string, sourceEl: HTMLElement): void {
    const comments = this.getThreadComments(threadId);
    if (comments.length === 0) {
      this.renderHoverContent(container, threadId, comments, sourceEl);
      return;
    }

    clearElement(container);

    const header = container.createDiv({ cls: "onc-comment-header" });
    header.createDiv({ cls: "onc-comment-style-name", text: this.t("addReply") });

    const authorInput = this.renderAuthorInput(container, "");
    const textarea = container.createEl("textarea", { cls: "onc-edit-textarea onc-bottom-edit-textarea" });
    textarea.setAttribute("aria-label", this.t("replyContent"));
    textarea.placeholder = this.t("replyPlaceholder");
    textarea.rows = 3;

    const actions = container.createDiv({ cls: "onc-comment-actions" });
    const saveButton = actions.createEl("button", { cls: "onc-comment-action onc-icon-button" });
    saveButton.type = "button";
    saveButton.setAttribute("aria-label", this.t("saveReply"));
    saveButton.setAttribute("title", this.t("saveReply"));
    setIcon(saveButton, "check");

    const cancelButton = actions.createEl("button", { cls: "onc-comment-action onc-icon-button" });
    cancelButton.type = "button";
    cancelButton.setAttribute("aria-label", this.t("cancel"));
    cancelButton.setAttribute("title", this.t("cancel"));
    setIcon(cancelButton, "x");

    const submit = async (): Promise<void> => {
      const saved = await this.addThreadReply(threadId, textarea.value, authorInput.value);
      if (saved && container.isConnected) {
        this.renderHoverContent(container, threadId, this.getThreadComments(threadId), sourceEl);
      }
    };

    saveButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    });

    cancelButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.renderHoverContent(container, threadId, this.getThreadComments(threadId), sourceEl);
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

    window.setTimeout(() => {
      this.autoResizeTextarea(textarea);
      textarea.focus();
    }, 0);
  }

  private prepareRenderedMarks(root: HTMLElement): void {
    const marks = root.querySelectorAll<HTMLElement>("span[data-onc-id]");
    for (const mark of Array.from(marks)) {
      const id = mark.getAttribute("data-onc-id");
      if (!id) {
        continue;
      }

      const comments = this.getThreadComments(id);
      mark.addClass("onc-comment-mark");
      mark.setAttribute("data-onc-style", this.getThreadStyleId(id, mark.getAttribute("data-onc-style") ?? this.settings.defaultStyleId));
      mark.setAttribute("tabindex", "0");
      mark.setAttribute("aria-label", this.getCommentMarkAriaLabel(comments.length));
    }
  }

  private renderCommentMarkdown(container: HTMLElement, comment: CommentRecord | null): void {
    clearElement(container);

    if (!comment) {
      container.setText(this.t("commentDataNotFound"));
      return;
    }

    const markdown = comment.comment.trim();
    if (!markdown) {
      container.setText(this.t("emptyComment"));
      return;
    }

    container.addClass("markdown-rendered");
    void MarkdownRenderer.render(this.app, markdown, container, comment.filePath, this);
  }

  private renderPanelEditContent(
    container: HTMLElement,
    threadId: string,
    comment: CommentRecord,
    sourceEl: HTMLElement
  ): void {
    clearElement(container);

    const header = container.createDiv({ cls: "onc-comment-header" });
    header.createDiv({ cls: "onc-comment-style-name", text: this.t("editComment") });

    const styleRow = container.createDiv({ cls: "onc-edit-style-row" });
    this.renderStylePicker(styleRow, this.getThreadStyleId(threadId, comment.styleId), (styleId) => {
      void this.updateCommentThreadStyle(threadId, styleId);
    });

    const actions = styleRow.createDiv({ cls: "onc-edit-style-actions" });
    const doneButton = actions.createEl("button", { cls: "onc-comment-action onc-icon-button" });
    doneButton.type = "button";
    doneButton.setAttribute("aria-label", this.t("doneEditing"));
    doneButton.setAttribute("title", this.t("doneEditing"));
    setIcon(doneButton, "check");

    const authorInput = this.renderAuthorInput(container, comment.authorName);
    const textarea = container.createEl("textarea", { cls: "onc-edit-textarea onc-bottom-edit-textarea" });
    textarea.setAttribute("aria-label", this.t("commentContent"));
    textarea.placeholder = this.t("commentPlaceholder");
    textarea.value = comment.comment;
    textarea.rows = 3;

    textarea.addEventListener("input", () => {
      comment.comment = textarea.value;
      comment.updatedAt = Date.now();
      this.autoResizeTextarea(textarea);
      this.scheduleEditSave();
    });

    authorInput.addEventListener("input", () => {
      comment.authorName = resolveCommenterName(authorInput.value, this.settings.commenterName);
      comment.updatedAt = Date.now();
      this.scheduleEditSave();
    });

    doneButton.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.flushEditSave();
      this.renderHoverContent(container, threadId, this.getThreadComments(threadId), sourceEl);
    });

    window.setTimeout(() => {
      this.autoResizeTextarea(textarea);
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);
  }

  private renderEditPopover(comment: CommentRecord): void {
    if (!this.editPopoverEl) {
      return;
    }

    clearElement(this.editPopoverEl);

    const threadId = getCommentThreadId(comment);
    const styleRow = this.editPopoverEl.createDiv({ cls: "onc-edit-style-row" });
    this.renderStylePicker(styleRow, this.getThreadStyleId(threadId, comment.styleId), (styleId) => {
      void this.updateCommentThreadStyle(threadId, styleId);
    });

    const authorInput = this.renderAuthorInput(this.editPopoverEl, comment.authorName);
    const textarea = this.editPopoverEl.createEl("textarea", { cls: "onc-edit-textarea" });
    textarea.setAttribute("aria-label", this.t("commentContent"));
    textarea.placeholder = this.t("commentPlaceholder");
    textarea.value = comment.comment;
    textarea.rows = 3;

    textarea.addEventListener("input", () => {
      comment.comment = textarea.value;
      comment.updatedAt = Date.now();
      this.autoResizeTextarea(textarea);
      this.scheduleEditSave();
    });

    authorInput.addEventListener("input", () => {
      comment.authorName = resolveCommenterName(authorInput.value, this.settings.commenterName);
      comment.updatedAt = Date.now();
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
    saveButton.setAttribute("aria-label", this.t("addHighlightComment"));
    saveButton.setAttribute("title", this.t("addHighlightComment"));
    setIcon(saveButton, "check");

    const cancelButton = actions.createEl("button", { cls: "onc-comment-action onc-icon-button" });
    cancelButton.type = "button";
    cancelButton.setAttribute("aria-label", this.t("cancel"));
    cancelButton.setAttribute("title", this.t("cancel"));
    setIcon(cancelButton, "x");

    const authorInput = this.renderAuthorInput(this.editPopoverEl, "");
    const textarea = this.editPopoverEl.createEl("textarea", { cls: "onc-edit-textarea" });
    textarea.setAttribute("aria-label", this.t("commentContent"));
    textarea.placeholder = this.t("commentPlaceholder");
    textarea.rows = 3;

    const submit = async (): Promise<void> => {
      await this.createCommentFromDraft(draft, textarea.value, stylePicker.getValue(), authorInput.value);
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

  private async createCommentFromDraft(
    draft: CreateCommentDraft,
    commentText: string,
    styleId: string,
    authorNameText: string
  ): Promise<void> {
    const comment = commentText.trim();
    if (!comment) {
      new Notice(this.t("emptyCommentNotice"));
      return;
    }

    const id = createCommentId();
    const now = Date.now();
    const resolvedStyleId = this.getStyle(styleId).id;

    this.settings.comments.push({
      id,
      threadId: id,
      filePath: draft.filePath,
      quote: draft.selectedText,
      comment,
      authorName: resolveCommenterName(authorNameText, this.settings.commenterName),
      styleId: resolvedStyleId,
      createdAt: now,
      updatedAt: now
    });

    draft.editor.replaceRange(buildCommentMarkup(draft.selectedText, id, resolvedStyleId), draft.from, draft.to);
    await this.saveSettings();
    this.closeEditPopover();
    new Notice(this.t("addedCommentNotice"));
  }

  private async addThreadReply(threadId: string, commentText: string, authorNameText: string): Promise<boolean> {
    const comment = commentText.trim();
    if (!comment) {
      new Notice(this.t("emptyCommentNotice"));
      return false;
    }

    const primaryComment = this.getThreadPrimaryComment(threadId);
    if (!primaryComment) {
      new Notice(this.t("markCommentDataNotFoundNotice"));
      return false;
    }

    const now = Date.now();
    this.settings.comments.push({
      id: createCommentId(),
      threadId,
      filePath: primaryComment.filePath,
      quote: primaryComment.quote,
      comment,
      authorName: resolveCommenterName(authorNameText, this.settings.commenterName),
      styleId: this.getThreadStyleId(threadId, primaryComment.styleId),
      createdAt: now,
      updatedAt: now
    });

    await this.saveSettings();
    new Notice(this.t("addedReplyNotice"));
    return true;
  }

  private renderAuthorInput(parentEl: HTMLElement, value: string): HTMLInputElement {
    const input = parentEl.createEl("input", { cls: "onc-author-input" });
    input.type = "text";
    input.setAttribute("aria-label", this.t("authorName"));
    input.placeholder = `${this.t("authorPlaceholderPrefix")}: ${this.settings.commenterName}`;
    input.value = value;
    return input;
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
    trigger.setAttribute("aria-label", this.t("markStyle"));
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
      label.setText(this.getStyleDisplayName(style));
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
      option.createSpan({ cls: "onc-style-picker-option-label", text: this.getStyleDisplayName(style) });

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

  private async updateCommentThreadStyle(threadId: string, styleId: string): Promise<void> {
    const comments = this.getThreadComments(threadId);
    const primaryComment = comments[0];
    if (!primaryComment) {
      return;
    }

    const nextStyleId = this.getStyle(styleId).id;
    if (comments.every((comment) => comment.styleId === nextStyleId)) {
      return;
    }

    const now = Date.now();
    for (const comment of comments) {
      comment.styleId = nextStyleId;
      comment.updatedAt = now;
    }

    this.updateVisibleMarkStyle(threadId, nextStyleId);
    await this.rewriteCommentMarkup((markdown) => {
      return updateCommentSpanStyle(markdown, threadId, nextStyleId);
    }, primaryComment.filePath);
    await this.saveSettings();
  }

  private updateVisibleMarkStyle(id: string, styleId: string): void {
    const selector = `.onc-comment-mark[data-onc-id="${cssAttributeValue(id)}"]`;
    const marks = document.querySelectorAll<HTMLElement>(selector);
    for (const mark of Array.from(marks)) {
      mark.setAttribute("data-onc-style", styleId);
    }
  }

  refreshVisibleMarkLabels(): void {
    const marks = document.querySelectorAll<HTMLElement>(".onc-comment-mark[data-onc-id]");
    for (const mark of Array.from(marks)) {
      const id = mark.getAttribute("data-onc-id");
      if (!id) {
        continue;
      }
      mark.setAttribute("aria-label", this.getCommentMarkAriaLabel(this.getThreadComments(id).length));
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
    const cssMaxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
    const viewportMaxHeight = Math.floor(window.innerHeight * 0.5);
    const maxHeight = Number.isFinite(cssMaxHeight)
      ? Math.min(cssMaxHeight, viewportMaxHeight)
      : viewportMaxHeight;
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
    const roots = [this.editPopoverEl, this.bottomSheetEl, this.inlinePopoverEl, this.rightPanelEl];
    for (const root of roots) {
      const pickers = root?.querySelectorAll<HTMLElement>(".onc-style-picker.onc-open") ?? [];
      for (const picker of Array.from(pickers)) {
        picker.removeClass("onc-open");
        picker.querySelector("button")?.setAttribute("aria-expanded", "false");
      }
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
    this.flushEditSave();
    this.closeStylePickers();
    this.inlineAnchorEl = null;
    this.bottomSheetEl?.removeClass("onc-visible");
    this.inlinePopoverEl?.removeClass("onc-visible");
    this.rightPanelEl?.removeClass("onc-visible");
  }

  private closeEditPopover(): void {
    this.flushEditSave();
    this.closeStylePickers();
    this.editAnchorEl = null;
    this.createAnchorRange = null;
    this.activeEditThreadId = null;
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

    if ((!this.editAnchorEl || !this.editAnchorEl.isConnected) && this.activeEditThreadId) {
      this.editAnchorEl = this.findVisibleMarkElement(this.activeEditThreadId);
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
    const delayMs = this.settings.displayMode === "inline-popover" ? 180 : 650;
    this.hideTimer = window.setTimeout(() => {
      this.hideHoverSurfaces();
      this.hideTimer = null;
    }, delayMs);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private isInsideHoverSurface(node: Node): boolean {
    return Boolean(this.bottomSheetEl?.contains(node) || this.inlinePopoverEl?.contains(node) || this.rightPanelEl?.contains(node));
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

    const languageSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingLanguageName"))
      .setDesc(this.plugin.t("settingLanguageDesc"));
    this.renderSettingsDropdown(
      languageSetting.controlEl,
      [
        { value: "zh", label: this.plugin.t("languageZh") },
        { value: "en", label: this.plugin.t("languageEn") }
      ],
      this.plugin.settings.language,
      async (value) => {
        this.plugin.settings.language = normalizeLanguage(value);
        await this.plugin.saveSettings();
        this.plugin.refreshCommands();
        this.plugin.refreshVisibleMarkLabels();
        this.display();
      },
      this.plugin.t("settingLanguageName")
    );

    const displayModeSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingDisplayModeName"))
      .setDesc(this.plugin.t("settingDisplayModeDesc"));
    this.renderSettingsDropdown(
      displayModeSetting.controlEl,
      [
        { value: "bottom-sheet", label: this.plugin.t("displayModeBottomSheet") },
        { value: "inline-popover", label: this.plugin.t("displayModeInlinePopover") },
        { value: "right-side", label: this.plugin.t("displayModeRightSide") }
      ],
      this.plugin.settings.displayMode,
      async (value) => {
        this.plugin.settings.displayMode = value as CommentDisplayMode;
        await this.plugin.saveSettings();
      },
      this.plugin.t("settingDisplayModeName")
    );

    new Setting(containerEl)
      .setName(this.plugin.t("settingDefaultAuthorName"))
      .setDesc(this.plugin.t("settingDefaultAuthorDesc"))
      .addText((text) => {
        text
          .setPlaceholder("Note Taker")
          .setValue(this.plugin.settings.commenterName)
          .onChange(async (value) => {
            this.plugin.settings.commenterName = normalizeCommenterName(value);
            await this.plugin.saveSettings();
          });
      });

    const defaultStyleSetting = new Setting(containerEl)
      .setName(this.plugin.t("settingDefaultStyleName"))
      .setDesc(this.plugin.t("settingDefaultStyleDesc"));
    this.renderSettingsDropdown(
      defaultStyleSetting.controlEl,
      this.plugin.settings.styles.map((style) => ({
        value: style.id,
        label: this.plugin.getStyleDisplayName(style),
        swatchColor: style.backgroundColor,
        swatchBorderColor: style.underlineColor
      })),
      this.plugin.settings.defaultStyleId,
      async (value) => {
        this.plugin.settings.defaultStyleId = value;
        await this.plugin.saveSettings();
      },
      this.plugin.t("settingDefaultStyleName")
    );

    new Setting(containerEl)
      .setName(this.plugin.t("settingStylesName"))
      .setDesc(this.plugin.t("settingStylesDesc"))
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("addStyle"))
          .onClick(async () => {
            await this.plugin.addCustomStyle();
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("resetStyles"))
          .onClick(async () => {
            if (!window.confirm(this.plugin.t("confirmResetStyles"))) {
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
    section.createEl("h3", { text: this.plugin.getStyleDisplayName(style) });

    new Setting(section)
      .setName(this.plugin.t("styleName"))
      .addText((text) => {
        text
          .setValue(this.plugin.getStyleDisplayName(style))
          .onChange(async (value) => {
            style.name = value.trim() || this.plugin.t("untitledStyleName");
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName(this.plugin.t("backgroundColor"))
      .addColorPicker((picker) => {
        picker
          .setValue(style.backgroundColor)
          .onChange(async (value) => {
            style.backgroundColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName(this.plugin.t("textColor"))
      .addColorPicker((picker) => {
        picker
          .setValue(normalizeColorPickerValue(style.textColor))
          .onChange(async (value) => {
            style.textColor = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(section)
      .setName(this.plugin.t("underlineColor"))
      .addColorPicker((picker) => {
        picker
          .setValue(style.underlineColor)
          .onChange(async (value) => {
            style.underlineColor = value;
            await this.plugin.saveSettings();
          });
      });

    const underlineSetting = new Setting(section).setName(this.plugin.t("underlineStyle"));
    this.renderSettingsDropdown(
      underlineSetting.controlEl,
      [
        { value: "solid", label: this.plugin.t("underlineSolid") },
        { value: "dotted", label: this.plugin.t("underlineDotted") },
        { value: "dashed", label: this.plugin.t("underlineDashed") },
        { value: "wavy", label: this.plugin.t("underlineWavy") }
      ],
      style.underlineStyle,
      async (value) => {
        style.underlineStyle = safeUnderlineStyle(value);
        await this.plugin.saveSettings();
      },
      this.plugin.t("underlineStyle")
    );

    new Setting(section)
      .setName(this.plugin.t("deleteStyle"))
      .setDesc(this.plugin.t("deleteStyleDesc"))
      .addButton((button) => {
        button
          .setButtonText(this.plugin.t("delete"))
          .setWarning()
          .onClick(async () => {
            if (!window.confirm(`${this.plugin.t("confirmDeleteStylePrefix")}${this.plugin.getStyleDisplayName(style)}${this.plugin.t("confirmDeleteStyleSuffix")}`)) {
              return;
            }
            await this.plugin.removeStyle(style.id);
            this.display();
          });
      });
  }

  private renderSettingsDropdown(
    parentEl: HTMLElement,
    options: DropdownOption[],
    selectedValue: string,
    onChange: (value: string) => Promise<void>,
    ariaLabel: string
  ): void {
    let currentValue = options.some((option) => option.value === selectedValue) ? selectedValue : options[0]?.value ?? "";
    const wrapper = parentEl.createDiv({ cls: "onc-style-picker onc-settings-select" });
    const trigger = wrapper.createEl("button", { cls: "onc-style-picker-trigger" });
    trigger.type = "button";
    trigger.setAttribute("aria-label", ariaLabel);
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

    const update = (): void => {
      const selected = options.find((option) => option.value === currentValue) ?? options[0];
      label.setText(selected?.label ?? "");
      if (selected?.swatchColor) {
        swatch.style.display = "";
        swatch.style.backgroundColor = selected.swatchColor;
        swatch.style.borderColor = selected.swatchBorderColor ?? selected.swatchColor;
      } else {
        swatch.style.display = "none";
      }

      const optionEls = menu.querySelectorAll<HTMLElement>(".onc-style-picker-option");
      for (const optionEl of Array.from(optionEls)) {
        const selectedOption = optionEl.dataset.value === currentValue;
        optionEl.toggleClass("is-selected", selectedOption);
        optionEl.setAttribute("aria-selected", selectedOption ? "true" : "false");
      }
    };

    for (const option of options) {
      const optionEl = menu.createEl("button", { cls: "onc-style-picker-option" });
      optionEl.type = "button";
      optionEl.dataset.value = option.value;
      optionEl.setAttribute("role", "option");

      if (option.swatchColor) {
        const optionSwatch = optionEl.createSpan({ cls: "onc-style-picker-swatch" });
        optionSwatch.style.backgroundColor = option.swatchColor;
        optionSwatch.style.borderColor = option.swatchBorderColor ?? option.swatchColor;
      }
      optionEl.createSpan({ cls: "onc-style-picker-option-label", text: option.label });

      optionEl.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        currentValue = option.value;
        update();
        close();
        void onChange(currentValue);
      });
    }

    trigger.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !wrapper.hasClass("onc-open");
      this.closeSettingsDropdowns();
      wrapper.toggleClass("onc-open", shouldOpen);
      trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    });

    update();
  }

  private closeSettingsDropdowns(): void {
    const pickers = this.containerEl.querySelectorAll<HTMLElement>(".onc-settings-select.onc-open");
    for (const picker of Array.from(pickers)) {
      picker.removeClass("onc-open");
      picker.querySelector("button")?.setAttribute("aria-expanded", "false");
    }
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

    const styleId = plugin.getThreadStyleId(span.id, span.styleId ?? plugin.settings.defaultStyleId);
    const commentCount = plugin.getThreadComments(span.id).length;
    builder.add(
      span.contentFrom,
      span.contentTo,
      Decoration.mark({
        class: "onc-comment-mark onc-editor-comment-mark",
        attributes: {
          "data-onc-id": span.id,
          "data-onc-style": styleId,
          "aria-label": plugin.getCommentMarkAriaLabel(commentCount)
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

function normalizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : DEFAULT_LANGUAGE;
}

function translate(language: Language, key: TranslationKey): string {
  return TRANSLATIONS[language]?.[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key];
}

function createDefaultStyles(language: Language): HighlightStyle[] {
  return DEFAULT_STYLES.map((style) => ({
    ...style,
    name: translate(language, DEFAULT_STYLE_NAME_KEYS[style.id] ?? "untitledStyleName")
  }));
}

function getStyleDisplayName(style: HighlightStyle, language: Language): string {
  const key = DEFAULT_STYLE_NAME_KEYS[style.id];
  const name = style.name?.trim();
  if (!key || !name) {
    return name || translate(language, "untitledStyleName");
  }

  const defaultNames = Object.keys(TRANSLATIONS).map((entry) => translate(entry as Language, key));
  return defaultNames.includes(name) ? translate(language, key) : name;
}

function normalizeDisplayMode(value: unknown): CommentDisplayMode {
  if (value === "inline-popover" || value === "right-side") {
    return value;
  }
  return "bottom-sheet";
}

function normalizeCommenterName(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "Note Taker";
}

function resolveCommenterName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : normalizeCommenterName(fallback);
}

function normalizeStyles(styles: HighlightStyle[] | undefined, language: Language): HighlightStyle[] {
  const source = Array.isArray(styles) && styles.length > 0 ? styles : createDefaultStyles(language);
  const normalized = source
    .filter((style) => typeof style.id === "string" && style.id.trim())
    .map((style) => ({
      id: style.id,
      name: style.name?.trim() || translate(language, "untitledStyleName"),
      backgroundColor: normalizeColorPickerValue(style.backgroundColor),
      textColor: normalizeColorPickerValue(style.textColor),
      underlineColor: normalizeColorPickerValue(style.underlineColor),
      underlineStyle: safeUnderlineStyle(style.underlineStyle)
    }));

  return normalized.length > 0 ? normalized : createDefaultStyles(language);
}

function normalizeComments(
  comments: CommentRecord[] | undefined,
  defaultStyleId: string,
  defaultCommenterName: string
): CommentRecord[] {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments
    .filter((comment) => typeof comment.id === "string" && typeof comment.comment === "string")
    .map((comment) => ({
      id: comment.id,
      threadId: getCommentThreadId(comment),
      filePath: comment.filePath ?? "",
      quote: comment.quote ?? "",
      comment: comment.comment,
      authorName: resolveCommenterName(comment.authorName, defaultCommenterName),
      styleId: comment.styleId ?? defaultStyleId,
      createdAt: comment.createdAt ?? Date.now(),
      updatedAt: comment.updatedAt ?? comment.createdAt ?? Date.now()
    }));
}

function getCommentThreadId(comment: CommentRecord): string {
  return typeof comment.threadId === "string" && comment.threadId.trim() ? comment.threadId : comment.id;
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
