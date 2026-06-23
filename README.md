# Notes Comments

Obsidian 插件：在笔记中选中文字后添加勾划标记，并给标记绑定留言或 note 补充内容。

## 功能

- 选中文字后运行命令 `添加标记留言`，写入留言并生成标记。
- 标记样式可在插件设置中自定义。
- 内置预设：黄色荧光、蓝色批注、绿色虚线、玫瑰波浪。
- 留言展示方式可选：
  - 鼠标移动到标记处时，底部中间向上滑出留言框。
  - 鼠标移动到标记处时，在标记附近弹出留言框。
- 在留言框中可以编辑或删除已有留言。
- 支持命令 `编辑光标处的标记留言` 和 `删除光标处的标记留言`。

## 开发

```bash
npm install
npm run build
```

构建后会生成 `main.js`。作为 Obsidian 插件使用时，将 `manifest.json`、`main.js` 和 `styles.css` 放在 vault 的 `.obsidian/plugins/obsidian-notes-comments/` 目录下并启用插件。

## 数据格式

插件会在 Markdown 中写入类似下面的 span，以便标记能随笔记内容保存：

```html
<span class="onc-comment-mark" data-onc-id="..." data-onc-style="yellow-marker">被标记的文字</span>
```

留言内容、样式和展示方式保存在插件的 `data.json` 中。
