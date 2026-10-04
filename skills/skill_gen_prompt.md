提供一个all.md,包含下面文件的内容：
core.md
faijs-extra.md
faijs-fasteners.md
faijs-gears.md
sheetmetal.md
sketch.md
SKILL.md
要除去重复的部分。

也许all.md里应该是SKILL.md里的部分内容，然后再一个个嵌入其他子包的文件。你可以用模板的方式写这个文件，js或者python模板语言的方式。执行以后得到最终的all.md。方便我一次性把所有需要的api提供给第三方AI。

排除draw.md，faijs-cadquery.md。

这个all.md应该是一个独立的文件，不应该引用任何其他的文件，也不应该有重复的内容。

在文件的头部介绍有哪些库，提供哪些建模能力，这是总体介绍。方便AI根据需求去找对应的文件部分。