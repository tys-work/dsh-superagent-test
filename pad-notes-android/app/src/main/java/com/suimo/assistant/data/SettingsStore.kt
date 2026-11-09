package com.suimo.assistant.data

import android.content.Context

/**
 * Local-first settings, stored in SharedPreferences. The Android analogue of
 * pad-notes-ai's `suimo.settings.v1` localStorage entry: nothing leaves the
 * device unless the user explicitly asks for an analysis.
 */
class SettingsStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): Settings {
        return Settings(
            provider = prefs.getString(KEY_PROVIDER, null) ?: Provider.DEMO.id,
            baseUrl = prefs.getString(KEY_BASE_URL, null) ?: Provider.OPENAI.defaultBaseUrl,
            model = prefs.getString(KEY_MODEL, null) ?: Provider.OPENAI.defaultModel,
            apiKey = prefs.getString(KEY_API_KEY, null).orEmpty(),
            crop = CropRegion(
                left = prefs.getFloat(KEY_CROP_LEFT, 0f),
                top = prefs.getFloat(KEY_CROP_TOP, 0f),
                right = prefs.getFloat(KEY_CROP_RIGHT, 1f),
                bottom = prefs.getFloat(KEY_CROP_BOTTOM, 1f),
            ).normalized(),
        )
    }

    fun save(settings: Settings) {
        prefs.edit()
            .putString(KEY_PROVIDER, settings.provider)
            .putString(KEY_BASE_URL, settings.baseUrl)
            .putString(KEY_MODEL, settings.model)
            .putString(KEY_API_KEY, settings.apiKey)
            .putFloat(KEY_CROP_LEFT, settings.crop.left)
            .putFloat(KEY_CROP_TOP, settings.crop.top)
            .putFloat(KEY_CROP_RIGHT, settings.crop.right)
            .putFloat(KEY_CROP_BOTTOM, settings.crop.bottom)
            .apply()
    }

    fun updateCrop(crop: CropRegion) {
        val normalized = crop.normalized()
        prefs.edit()
            .putFloat(KEY_CROP_LEFT, normalized.left)
            .putFloat(KEY_CROP_TOP, normalized.top)
            .putFloat(KEY_CROP_RIGHT, normalized.right)
            .putFloat(KEY_CROP_BOTTOM, normalized.bottom)
            .apply()
    }

    private companion object {
        const val PREFS_NAME = "suimo.settings"
        const val KEY_PROVIDER = "provider"
        const val KEY_BASE_URL = "base_url"
        const val KEY_MODEL = "model"
        const val KEY_API_KEY = "api_key"
        const val KEY_CROP_LEFT = "crop_left"
        const val KEY_CROP_TOP = "crop_top"
        const val KEY_CROP_RIGHT = "crop_right"
        const val KEY_CROP_BOTTOM = "crop_bottom"
    }
}
