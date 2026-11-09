package com.suimo.assistant.data

/**
 * The same provider presets as pad-notes-ai/js/ai.js (PROVIDERS).
 * "demo" stays first and is the default so the floating window can be tried
 * without a key; it never performs a network request.
 */
enum class Provider(
    val id: String,
    val label: String,
    val defaultBaseUrl: String,
    val defaultModel: String,
    val vision: Boolean,
    val hint: String,
) {
    DEMO(
        id = "demo",
        label = "本地演示",
        defaultBaseUrl = "",
        defaultModel = "",
        vision = false,
        hint = "内置示例建议，不发送任何内容到网络。",
    ),
    OPENAI(
        id = "openai",
        label = "OpenAI",
        defaultBaseUrl = "https://api.openai.com/v1",
        defaultModel = "gpt-4o-mini",
        vision = true,
        hint = "gpt-4o-mini 支持图片输入；任何 OpenAI 兼容的视觉模型都可以手动填写。",
    ),
    DEEPSEEK(
        id = "deepseek",
        label = "DeepSeek",
        defaultBaseUrl = "https://api.deepseek.com/v1",
        defaultModel = "deepseek-chat",
        vision = false,
        hint = "DeepSeek 擅长文字推理；屏幕截图需要换成支持图片输入的视觉模型。",
    ),
    MOONSHOT(
        id = "moonshot",
        label = "Moonshot · Kimi",
        defaultBaseUrl = "https://api.moonshot.cn/v1",
        defaultModel = "moonshot-v1-8k-vision-preview",
        vision = true,
        hint = "使用 Kimi 的视觉模型即可读取笔记截图。",
    ),
    QWEN(
        id = "qwen",
        label = "通义千问",
        defaultBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1",
        defaultModel = "qwen-vl-max",
        vision = true,
        hint = "百炼兼容模式；qwen-vl-max 支持图片输入。",
    ),
    CUSTOM(
        id = "custom",
        label = "自定义",
        defaultBaseUrl = "",
        defaultModel = "",
        vision = true,
        hint = "填入任意 OpenAI 兼容服务的 Base URL、模型名与 API Key。",
    ),
    ;

    companion object {
        fun fromId(id: String?): Provider = entries.firstOrNull { it.id == id } ?: CUSTOM
    }
}
