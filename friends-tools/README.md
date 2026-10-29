# 官方牌池目录生成

`catalog.json` 从本仓库检出的 `apps/core` 源文件生成，来源为 [libnoname/noname](https://github.com/libnoname/noname)，遵循原项目 GPL-3.0-only 许可。请保留根目录 `LICENSE` 和上游出处。

重新生成并验证：

```sh
node --experimental-vm-modules friends-tools/generate-catalog.mjs
node --test friends-tools/catalog.test.mjs
```

生成器仅在独立 VM 中求值模块声明，不启动游戏或执行武将技能、卡牌效果；`noname` 导入由元数据桩替换。它不通过正则猜测牌堆内容，因而保留原始花色、点数、属性和扩展标签。

## 数据格式

- `cardPacks`：官方卡牌包 ID、中文名、`connect` 兼容标记、`defaults` 精确数量、`cards` 包内可选键，以及原始 `list` 牌堆模板。
- `cards`：所有卡牌／属性组合；键为 `卡牌ID|属性`，普通牌属性为空字符串。`defaultCount` 是所有包原始牌堆中该类型的总数，**不能直接当作用户当前已选包的默认数**，应合并已选包的 `defaults`。
- `characterPacks`：官方武将池 ID、中文名、兼容标记及武将记录，包含势力、体力、技能说明和特殊隐藏标记。
- `modes` 非空表示卡牌仅适用于这些模式；`forbid` 列出禁用模式。房间编辑器应在保存前检查，不能声称不兼容的牌会进入实际牌堆。

多个包可以共享同一卡牌类型或武将 ID。武将合并时按 ID 去重，同名但 ID 不同的版本保持独立。原版引擎的模式规则还可能限制选将资格，目录并不覆盖这些动态规则。

例如：标准包实际为 108 张；军争包为 53 张（含木牛流马）。应变牌堆的第五个元组字段包含附加标签；复制或调节数量时不可丢弃。

当前目录含 10 个卡牌包、178 种卡牌／属性组合、26 个武将池和 2,582 条武将记录。它覆盖本次上游检出版本，不代表所有第三方扩展。
