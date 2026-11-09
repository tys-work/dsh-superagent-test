package com.suimo.assistant.data

/**
 * Runtime settings. Mirrors the pad-notes-ai settings subset that matters for
 * screen suggestions: provider preset, OpenAI-compatible endpoint, key and the
 * crop rectangle chosen for the current screen.
 */
data class Settings(
    val provider: String = Provider.DEMO.id,
    val baseUrl: String = Provider.OPENAI.defaultBaseUrl,
    val model: String = Provider.OPENAI.defaultModel,
    val apiKey: String = "",
    val crop: CropRegion = CropRegion.FULL,
) {
    val providerInfo: Provider get() = Provider.fromId(provider)
    val isDemo: Boolean get() = provider == Provider.DEMO.id

    val isConfigured: Boolean
        get() = isDemo || (baseUrl.isNotBlank() && model.isNotBlank() && apiKey.isNotBlank())

    val usesVisionModel: Boolean
        get() = providerInfo.vision
}
