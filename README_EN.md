# Notes Comments

[中文](README.md)

An Obsidian plugin for highlighting selected note text and attaching threaded comments or supplemental notes to the highlight.

## Features

- Select text and run `Add highlighted comment` to write a comment and create a highlight.
- Add multiple comments to the same highlight and view them as a threaded conversation.
- Edit and delete individual comments. Deleting the last comment in a thread also removes the inline highlight.
- Customize highlight styles in the plugin settings.
- Built-in presets: Yellow highlight, Blue note, Green dotted, Rose wavy.
- Choose where comments appear:
  - A bottom sheet slides up from the bottom center when hovering highlighted text.
  - An inline popover appears near the highlight when hovering highlighted text.
  - A right side panel slides in from the middle right when hovering highlighted text.
- Comment windows cap their maximum height, so long comments and long threads scroll inside the content area instead of expanding indefinitely.
- Comment lists emphasize author names and de-emphasize timestamps, making authors and content easier to scan.
- Includes commands for `Edit comment at cursor` and `Remove comment at cursor`.
- The plugin settings can switch between Chinese and English, and command palette names update with the selected language.

## Usage

1. Select the text you want to highlight in the editor.
2. Run `Add highlighted comment`, or choose `Add highlighted comment` from the context menu.
3. Enter the author name and comment content. After saving, the selected text is wrapped with a highlight.
4. Hover the highlighted text to view the comment thread, then add replies, edit comments, or delete comments as needed.

## Settings

- `Comment display mode`: choose Bottom sheet, Inline popover, or Right side panel.
- `Language`: switch the plugin interface between Chinese and English.
- `Default author name`: used when the author field is empty while adding or editing comments.
- `Default highlight style`: the style used by default when adding highlighted comments.
- `Style presets`: add, delete, reset, or adjust highlight styles, including background color, text color, underline color, and underline style.

## Development

```bash
npm install
npm run build
```

The build outputs `main.js`. To use this as an Obsidian plugin, place `manifest.json`, `main.js`, and `styles.css` in your vault's `.obsidian/plugins/obsidian-notes-comments/` directory and enable the plugin.

## Data Format

The plugin writes a span like the following into Markdown so highlights are saved with the note content:

```html
<span class="onc-comment-mark" data-onc-id="..." data-onc-style="yellow-marker">highlighted text</span>
```

`data-onc-id` is the highlight thread ID. Multiple comments on the same highlight share this thread ID. Comment content, styles, and display mode are stored in the plugin's `data.json`.

## Changelog

### 0.3.0

- Added a language setting with Chinese and English interface support.
- Added bilingual text for command palette entries, context menus, settings, comment popovers, notices, and confirmation dialogs.
- Refreshes command palette names and accessibility labels on already-rendered highlights after switching languages.
- Built-in style names follow the selected language while preserving user-customized style names.
- Added this English README.

### 0.2.0

- Added support for multiple comments on the same highlight, displayed as a threaded conversation.
- Added editing and deletion for individual comments in a thread.
- Added the middle-right slide-in comment display mode.
- Improved popover height and scrolling behavior for long comments and long comment threads.
- Removed duplicate highlighted text from comment popovers.
- Improved author name display in comment lists so authors and content are easier to distinguish.
- Improved the custom dropdown styling on the settings page by removing extra option borders.

### 0.1.0

- Initial release: select text to add highlighted comments, customize highlight styles, show comments at the bottom or near the highlight, and edit or delete comments.
